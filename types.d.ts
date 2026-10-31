import * as functools_kit from 'functools-kit';
import * as telegram from 'telegram';

interface ILogger {
    log(topic: string, ...args: any[]): void;
    debug(topic: string, ...args: any[]): void;
    info(topic: string, ...args: any[]): void;
    warn(topic: string, ...args: any[]): void;
}
declare class LoggerService implements ILogger {
    private _commonLogger;
    log: (topic: string, ...args: any[]) => Promise<void>;
    debug: (topic: string, ...args: any[]) => Promise<void>;
    info: (topic: string, ...args: any[]) => Promise<void>;
    warn: (topic: string, ...args: any[]) => Promise<void>;
    setLogger: (logger: ILogger) => void;
}

declare class AuthService {
    readonly loggerService: LoggerService;
    signIn: () => Promise<void>;
}

/**
 * Промежуточное представление текста между Markdown и Telegram-HTML.
 *
 * Telegram не знает блочной разметки (p, ul, h1, table...), а из инлайновой
 * допускает ограниченный набор сущностей. Поэтому HTML, полученный из Markdown,
 * сначала сводится к плоскому списку блоков из стилизованных отрезков текста,
 * а уже из него собирается HTML только с разрешёнными тегами. Такое же
 * представление используется для нарезки длинных постов на несколько сообщений:
 * резать можно внутри любого отрезка, не ломая вложенность тегов.
 */
interface TextRun {
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    spoiler?: boolean;
    /** Моноширинный инлайн. Telegram запрещает совмещать его с другими стилями */
    code?: boolean;
    /** Абсолютный URL ссылки (http(s)://, tg://, mailto:) */
    href?: string;
}
interface ParagraphBlock {
    type: "paragraph";
    runs: TextRun[];
}
interface BlockquoteBlock {
    type: "blockquote";
    runs: TextRun[];
    /** Свёрнутая по умолчанию цитата: <blockquote expandable> */
    expandable?: boolean;
}
interface PreBlock {
    type: "pre";
    text: string;
    /** Язык подсветки из ```lang, пустая строка если не задан */
    language: string;
}
type TextBlock = ParagraphBlock | BlockquoteBlock | PreBlock;

declare class MarkdownService {
    readonly loggerService: LoggerService;
    /**
     * Markdown в «сырой» HTML от marked, ещё со всеми тегами (p, ul, h1...).
     */
    renderHtml: (markdown: string) => Promise<string>;
    /**
     * Любой HTML в блоки: остаётся только то, что Telegram умеет показать.
     */
    htmlToBlocks: (html: string) => Promise<TextBlock[]>;
    markdownToBlocks: (markdown: string) => Promise<TextBlock[]>;
    blocksToHtml: (blocks: TextBlock[]) => string;
    /**
     * Markdown в HTML только с тегами, которые принимает Telegram
     * (b, i, u, s, spoiler, code, pre, blockquote, a).
     */
    markdownToHtml: (markdown: string) => Promise<string>;
    /**
     * Markdown в список HTML-сообщений, каждое не длиннее limit символов
     * видимого текста. Пустой Markdown даёт пустой список.
     */
    markdownToChunks: (markdown: string, limit: number) => Promise<string[]>;
}

interface WriterMessage {
    /** Message id assigned by Telegram within the chat */
    id: number;
    /** Chat exactly as passed in the request */
    chat: string;
    /** Server-side send time */
    date: Date;
}

declare class WriterService {
    readonly loggerService: LoggerService;
    readonly markdownService: MarkdownService;
    sendMessage: (dto: {
        chat: string;
        content: string;
        photos?: Array<string | Buffer>;
        silent?: boolean;
        replyTo?: number;
        linkPreview?: boolean;
    }) => Promise<WriterMessage[]>;
}

declare class TelegramGlobalService {
    readonly loggerService: LoggerService;
    readonly authService: AuthService;
    readonly writerService: WriterService;
    signIn: () => Promise<void>;
    sendMessage: (dto: {
        chat: string;
        content: string;
        photos?: Array<string | Buffer>;
        silent?: boolean;
        replyTo?: number;
        linkPreview?: boolean;
    }) => Promise<WriterMessage[]>;
}

declare const lib: {
    telegramGlobalService: TelegramGlobalService;
    authService: AuthService;
    loggerService: LoggerService;
    markdownService: MarkdownService;
    writerService: WriterService;
};

/**
 * Signs the client in to Telegram, establishing an authorized MTProto session.
 *
 * Delegates to the auth service, which drives the interactive authentication
 * flow (QR code, then the 2FA password if enabled) and persists the resulting
 * session to `./session.txt` so that subsequent {@link sendMessage} calls can
 * reuse it without re-authenticating.
 *
 * Must be called once before {@link sendMessage} when no saved session exists.
 *
 * @returns Promise that resolves once the session is authorized
 */
declare function signIn(): Promise<void>;

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
declare function sendMessage(dto: {
    chat: string;
    content: string;
    photos?: Array<string | Buffer>;
    silent?: boolean;
    replyTo?: number;
    linkPreview?: boolean;
}): Promise<WriterMessage[]>;

declare const getTelegram: (() => Promise<telegram.TelegramClient>) & functools_kit.ISingleshotClearable<() => Promise<telegram.TelegramClient>>;

declare const GLOBAL_CONFIG: {
    CC_TELEGRAM_API_ID: number;
    CC_TELEGRAM_API_HASH: string;
    /** Max characters of a plain text message. Telegram hard limit is 4096 */
    CC_TELEGRAM_MESSAGE_LIMIT: number;
    /** Max characters of a photo caption. Telegram limit is 1024 (4096 for premium accounts) */
    CC_TELEGRAM_CAPTION_LIMIT: number;
};
type Config = typeof GLOBAL_CONFIG;
declare const getConfig: () => {
    CC_TELEGRAM_API_ID: number;
    CC_TELEGRAM_API_HASH: string;
    CC_TELEGRAM_MESSAGE_LIMIT: number;
    CC_TELEGRAM_CAPTION_LIMIT: number;
};
declare const setConfig: (config: Partial<Config>) => void;

export { type WriterMessage, getConfig, getTelegram, lib, sendMessage, setConfig, signIn };
