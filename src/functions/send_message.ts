import lib from "../lib";

/**
 * Publishes a Markdown post, optionally with photos, to a Telegram chat or channel.
 *
 * The Markdown is rendered to HTML, then reduced to the tags Telegram accepts
 * (`b`, `i`, `u`, `s`, `spoiler`, `code`, `pre`, `blockquote`, `a`); block
 * structure that Telegram cannot display is flattened into text (headings become
 * bold lines, lists become bullet lines, tables become monospace blocks, images
 * become links). The conversion happens inside; raw Markdown never reaches Telegram.
 *
 * Delivery rules:
 * - Without photos the text is sent as one or more messages, each within the
 *   message limit (`CC_TELEGRAM_MESSAGE_LIMIT`, 4096 by default). A long post is
 *   split between paragraphs, or inside a paragraph at a line/word boundary;
 *   formatting never breaks across messages.
 * - With photos the photos are sent first as albums of up to 10 items. The text
 *   becomes the caption of the first album when it fits the caption limit
 *   (`CC_TELEGRAM_CAPTION_LIMIT`, 1024 by default); otherwise the albums go
 *   without a caption and the text follows as separate messages.
 * - Photos are accepted as base64 strings (the format `telegram-reader` returns),
 *   data-URLs or Buffers. Each is rotated by EXIF, downsized to at most 2560px on
 *   the long side and re-encoded as JPEG so Telegram treats it as a photo.
 *
 * @param dto - Send parameters
 * @param dto.chat - Chat username (`"channel"`, `"@channel"`), numeric id as a string, or `"me"`
 * @param dto.content - Post body in Markdown (GFM; single newlines are line breaks)
 * @param dto.photos - Photos to attach: base64, data-URL or Buffer each
 * @param dto.silent - Send without notifying the chat members
 * @param dto.replyTo - Id of the message to reply to (applied to the first sent message)
 * @param dto.linkPreview - Show a link preview for the first URL (defaults to `false`)
 * @returns Promise resolving to the sent messages in send order
 */
export async function sendMessage(dto: {
    chat: string;
    content: string;
    photos?: Array<string | Buffer>;
    silent?: boolean;
    replyTo?: number;
    linkPreview?: boolean;
}) {
    lib.loggerService.log("functions.sendMessage", {
        chat: dto.chat,
        length: (dto.content || "").length,
        photos: (dto.photos || []).length,
    });
    return await lib.telegramGlobalService.sendMessage(dto);
}
