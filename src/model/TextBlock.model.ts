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
export interface TextRun {
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

export interface ParagraphBlock {
    type: "paragraph";
    runs: TextRun[];
}

export interface BlockquoteBlock {
    type: "blockquote";
    runs: TextRun[];
    /** Свёрнутая по умолчанию цитата: <blockquote expandable> */
    expandable?: boolean;
}

export interface PreBlock {
    type: "pre";
    text: string;
    /** Язык подсветки из ```lang, пустая строка если не задан */
    language: string;
}

export type TextBlock = ParagraphBlock | BlockquoteBlock | PreBlock;
