import { inject } from "../../core/di";
import LoggerService from "./LoggerService";
import MarkdownService from "./MarkdownService";
import TYPES from "../../core/types";
import { getTelegram } from "../../../config/telegram";
import { getConfig } from "../../../config/params";
import { WriterMessage } from "../../../model/WriterMessage.model";
import { execpool } from "functools-kit";
import type { Api } from "telegram";
import sharp from "sharp";

// Длинная сторона фото: 2560px — самый крупный размер, который Telegram
// хранит для фото сам; всё, что больше, сервер ужмёт, трафик уйдёт зря.
// Заодно гарантируется лимит фото «ширина + высота <= 10000»
const PHOTO_MAX_SIDE = 2560;

// Качество JPEG. Сервер Telegram пережимает фото повторно, выше 85 разницы
// на выходе нет, а вес растёт
const PHOTO_JPEG_QUALITY = 85;

// Telegram принимает не больше 10 медиа в одном альбоме
const ALBUM_MAX_FILES = 10;

// Ограничение одновременной обработки фото, чтобы не получить OOM на слабом железе
const MAX_EXEC = 5;

// Даем задержку чтобы кластер пришел в норму
const EXEC_DELAY = 100;

// Base64 (в том виде, как его отдаёт telegram-reader) либо data-URL либо байты
const toBuffer = (photo: string | Buffer): Buffer => {
  if (Buffer.isBuffer(photo)) {
    return photo;
  }
  const base64 = photo.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
  return Buffer.from(base64, "base64");
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

const toWriterMessage = (chat: string, message: Api.Message): WriterMessage => ({
  id: message.id,
  chat,
  date: new Date(message.date * 1000),
});

/**
 * Приводит фото к виду, который Telegram точно примет как фото: поворот по
 * EXIF, длинная сторона не больше PHOTO_MAX_SIDE, JPEG.
 *
 * Расширение .jpg в имени CustomFile — единственный признак, по которому
 * gramjs отправит буфер как фото, а не как документ. Если sharp не смог
 * прочитать данные, отправляем как есть: пусть сервер решит, фото это или нет.
 *
 * @param photo - base64, data-URL или Buffer с изображением
 * @param index - Порядковый номер в посте, идёт в имя файла
 * @returns CustomFile для client.sendFile
 */
const PREPARE_PHOTO_FN = execpool(
  async (self: WriterService, photo: string | Buffer, index: number) => {
    // Ленивый импорт: у gramjs нет exports-карты, подпути в ESM резолвятся
    // только по полному пути с расширением
    const { CustomFile } = await import("telegram/client/uploads.js");
    const source = toBuffer(photo);
    let data = source;
    try {
      data = await sharp(source)
        .rotate()
        .resize({
          width: PHOTO_MAX_SIDE,
          height: PHOTO_MAX_SIDE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: PHOTO_JPEG_QUALITY })
        .toBuffer();
    } catch (error) {
      self.loggerService.warn(
        `writerService photo normalize failed index=${index}, using original`,
        error
      );
    }
    return new CustomFile(`photo_${index + 1}.jpg`, data.length, "", data);
  },
  {
    maxExec: MAX_EXEC,
    delay: EXEC_DELAY,
  }
);

export class WriterService {
  readonly loggerService = inject<LoggerService>(TYPES.loggerService);
  readonly markdownService = inject<MarkdownService>(TYPES.markdownService);

  public sendMessage = async (dto: {
    chat: string;
    content: string;
    photos?: Array<string | Buffer>;
    silent?: boolean;
    replyTo?: number;
    linkPreview?: boolean;
  }): Promise<WriterMessage[]> => {
    this.loggerService.log("writerService sendMessage", {
      chat: dto.chat,
      length: (dto.content || "").length,
      photos: (dto.photos || []).length,
    });
    const client = await getTelegram();
    const { CC_TELEGRAM_MESSAGE_LIMIT, CC_TELEGRAM_CAPTION_LIMIT } = getConfig();

    const photos = dto.photos || [];
    const silent = !!dto.silent;
    const linkPreview = !!dto.linkPreview;
    const sent: Api.Message[] = [];

    const sendText = async (limit: number) => {
      const chunks = await this.markdownService.markdownToChunks(dto.content, limit);
      for (const chunk of chunks) {
        const message = await client.sendMessage(dto.chat, {
          message: chunk,
          parseMode: "html",
          silent,
          linkPreview,
          // Отвечаем только первым сообщением: остальные идут продолжением
          replyTo: sent.length ? undefined : dto.replyTo,
        });
        sent.push(message);
      }
    };

    if (!photos.length) {
      await sendText(CC_TELEGRAM_MESSAGE_LIMIT);
      if (!sent.length) {
        this.loggerService.warn("writerService sendMessage nothing to send: empty content and no photos");
      }
      return sent.map((message) => toWriterMessage(dto.chat, message));
    }

    const files = await Promise.all(
      photos.map((photo, index) => PREPARE_PHOTO_FN(this, photo, index))
    );

    // Текст идёт подписью к первому альбому, если влезает в лимит подписи.
    // Иначе сначала уходят фото без подписи, затем текст отдельными сообщениями
    const captionChunks = await this.markdownService.markdownToChunks(
      dto.content,
      CC_TELEGRAM_CAPTION_LIMIT
    );
    const fitsCaption = captionChunks.length <= 1;

    const albums = chunkArray(files, ALBUM_MAX_FILES);
    for (const [albumIndex, album] of albums.entries()) {
      const caption = albumIndex === 0 && fitsCaption ? captionChunks[0] || "" : "";
      const result = (await client.sendFile(dto.chat, {
        file: album.length === 1 ? album[0] : album,
        caption: album.length === 1 ? caption : [caption, ...album.slice(1).map(() => "")],
        parseMode: "html",
        silent,
        replyTo: albumIndex === 0 ? dto.replyTo : undefined,
      })) as Api.Message | Api.Message[];
      sent.push(...(Array.isArray(result) ? result : [result]).filter(Boolean));
    }

    if (!fitsCaption) {
      await sendText(CC_TELEGRAM_MESSAGE_LIMIT);
    }

    return sent.map((message) => toWriterMessage(dto.chat, message));
  };
}

export default WriterService;
