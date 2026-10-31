import { singleshot } from "functools-kit";
import { inject } from "../../core/di";
import LoggerService from "./LoggerService";
import TYPES from "../../core/types";
import {
  TextBlock,
  TextRun,
  ParagraphBlock,
  BlockquoteBlock,
  PreBlock,
} from "../../../model/TextBlock.model";

/**
 * Минимальная структурная типизация DOM-узла htmlparser2/domhandler.
 * Собственный интерфейс вместо типов domhandler, чтобы не тащить его в
 * peer-зависимости: нужны только type/name/attribs/children/data.
 */
interface DomNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: DomNode[];
}

type Style = Omit<TextRun, "text">;

// Разделитель блоков в итоговом сообщении: пустая строка между абзацами
const SEPARATOR = "\n\n";

// Маркер ненумерованного списка и отступ вложенного уровня. Telegram сохраняет
// пробелы как есть, так что вложенность видна без спецсимволов
const BULLET = "• ";
const LIST_INDENT = "    ";

// Telegram принимает в ссылках только абсолютные URL этих схем; относительные
// и javascript: ссылки разворачиваем до простого текста
const ALLOWED_URL = /^(https?:\/\/|tg:\/\/|mailto:)/i;

// Язык подсветки в ```lang — только безопасные символы, иначе атрибут class
// можно было бы сломать кавычкой
const LANGUAGE_PATTERN = /(?:^|\s)language-([\w+#.-]+)/;

// Заголовки: в Telegram нет h1-h6, рендерим жирной строкой
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

// Блочные теги HTML: при встрече инлайн-поток переносится на новую строку
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "header", "footer", "main", "aside", "nav",
  "figure", "figcaption", "details", "summary", "address", "form", "fieldset",
  "dl", "dt", "dd", "li", "center", "body", "html",
]);

// Содержимое этих тегов в тексте поста не нужно никогда
const SKIP_TAGS = new Set([
  "script", "style", "template", "head", "title", "meta", "link", "noscript",
  "iframe", "object", "embed", "svg", "math", "canvas", "video", "audio",
]);

// Ленивые импорты: marked>=16 и htmlparser2>=11 собраны только как ESM.
// Через await import они одинаково работают и из cjs-, и из esm-сборки.
const getMarked = singleshot(async () => {
  const { Marked } = await import("marked");
  // breaks: одиночный перенос строки становится <br>. В чате перенос ожидают
  // буквально, а не как «мягкий» пробел по спецификации CommonMark
  return new Marked({ gfm: true, breaks: true });
});

const getParseDocument = singleshot(async () => {
  const { parseDocument } = await import("htmlparser2");
  return parseDocument;
});

const isElement = (node: DomNode) =>
  node.type === "tag" || node.type === "script" || node.type === "style";

const isText = (node: DomNode) => node.type === "text";

const tagName = (node: DomNode) => (node.name || "").toLowerCase();

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (text: string) => escapeHtml(text).replace(/"/g, "&quot;");

const charCount = (text: string) => Array.from(text).length;

const textContent = (node: DomNode): string => {
  if (isText(node)) {
    return node.data || "";
  }
  if (isElement(node) && SKIP_TAGS.has(tagName(node))) {
    return "";
  }
  return (node.children || []).map(textContent).join("");
};

const sanitizeUrl = (url: string | undefined): string | undefined => {
  if (!url) {
    return undefined;
  }
  const trimmed = url.trim();
  return ALLOWED_URL.test(trimmed) ? trimmed : undefined;
};

const sameStyle = (a: Style, b: Style) =>
  !!a.bold === !!b.bold &&
  !!a.italic === !!b.italic &&
  !!a.underline === !!b.underline &&
  !!a.strike === !!b.strike &&
  !!a.spoiler === !!b.spoiler &&
  !!a.code === !!b.code &&
  (a.href || "") === (b.href || "");

const runsLength = (runs: TextRun[]) =>
  runs.reduce((acc, run) => acc + run.text.length, 0);

/**
 * Убирает пустые отрезки и пробельные края списка отрезков, не трогая
 * внутренние переносы (отступы вложенных списков начинаются с пробелов).
 */
const trimEdges = (runs: TextRun[]): TextRun[] => {
  const result = runs.filter((run) => run.text);
  while (result.length && !result[0].text.trim()) {
    result.shift();
  }
  if (result.length) {
    result[0] = { ...result[0], text: result[0].text.replace(/^\s+/, "") };
  }
  while (result.length && !result[result.length - 1].text.trim()) {
    result.pop();
  }
  if (result.length) {
    const last = result.length - 1;
    result[last] = { ...result[last], text: result[last].text.replace(/\s+$/, "") };
  }
  return result;
};

/**
 * Склеивает соседние отрезки с одинаковым стилем, убирает хвостовые пробелы
 * перед переносами, схлопывает три и более переносов до пустой строки и
 * обрезает края. Результат — канонический вид блока: один тег на стиль,
 * без вложенных одноимённых тегов, которые парсер gramjs не различает.
 */
const normalizeRuns = (runs: TextRun[]): TextRun[] => {
  const merged: TextRun[] = [];
  for (const run of runs) {
    if (!run.text) {
      continue;
    }
    const prev = merged[merged.length - 1];
    if (prev && sameStyle(prev, run)) {
      prev.text += run.text;
      continue;
    }
    merged.push({ ...run });
  }
  let newlines = 0;
  for (const run of merged) {
    let out = "";
    for (const ch of run.text.replace(/[ \t]+\n/g, "\n")) {
      if (ch === "\n") {
        newlines += 1;
        if (newlines <= 2) {
          out += ch;
        }
        continue;
      }
      newlines = 0;
      out += ch;
    }
    run.text = out;
  }
  return trimEdges(merged);
};

const isEmptyBlock = (block: TextBlock) =>
  block.type === "pre" ? !block.text.trim() : block.runs.length === 0;

/**
 * Накопитель блоков. Инлайновые узлы верхнего уровня (сырой HTML вроде
 * <b>x</b> вне абзаца) собираются в неявный абзац, который закрывается
 * ближайшим блочным элементом.
 */
class BlockCollector {
  readonly blocks: TextBlock[] = [];
  private pending: TextRun[] | null = null;

  get hasPending() {
    return this.pending !== null;
  }

  inline(runs: TextRun[]) {
    if (!this.pending) {
      this.pending = [];
    }
    this.pending.push(...runs);
  }

  flush() {
    if (!this.pending) {
      return;
    }
    const runs = normalizeRuns(this.pending);
    this.pending = null;
    if (runs.length) {
      this.blocks.push({ type: "paragraph", runs });
    }
  }

  push(block: TextBlock) {
    this.flush();
    if (!isEmptyBlock(block)) {
      this.blocks.push(block);
    }
  }
}

/**
 * Собирает инлайновое содержимое узлов в отрезки текста. Блочные элементы,
 * встреченные внутри инлайна (например <p> в <li>), становятся переносами строк.
 */
const collectInline = (nodes: DomNode[], style: Style): TextRun[] => {
  const out: TextRun[] = [];

  const text = (value: string, override: Style = style) => {
    if (value) {
      out.push({ ...override, text: value });
    }
  };

  // Гарантирует, что дальнейший текст начнётся с новой строки, но не
  // добавляет перенос в самое начало и не дублирует уже стоящий
  const newline = () => {
    const tail = out.map((run) => run.text).join("").replace(/[ \t]+$/, "");
    if (!tail.trim() || tail.endsWith("\n")) {
      return;
    }
    out.push({ text: "\n" });
  };

  for (const node of nodes) {
    if (isText(node)) {
      text(node.data || "");
      continue;
    }
    if (!isElement(node)) {
      continue;
    }
    const name = tagName(node);
    const children = node.children || [];
    const attribs = node.attribs || {};
    if (SKIP_TAGS.has(name)) {
      continue;
    }
    switch (name) {
      case "br":
        out.push({ text: "\n" });
        break;
      case "strong":
      case "b":
        out.push(...collectInline(children, { ...style, bold: true }));
        break;
      case "em":
      case "i":
        out.push(...collectInline(children, { ...style, italic: true }));
        break;
      case "u":
      case "ins":
        out.push(...collectInline(children, { ...style, underline: true }));
        break;
      case "s":
      case "del":
      case "strike":
        out.push(...collectInline(children, { ...style, strike: true }));
        break;
      case "code":
      case "kbd":
      case "samp":
      case "tt":
        out.push(...collectInline(children, { ...style, code: true }));
        break;
      case "spoiler":
      case "tg-spoiler":
        out.push(...collectInline(children, { ...style, spoiler: true }));
        break;
      case "span": {
        const classes = (attribs.class || "").split(/\s+/);
        const spoiler = classes.includes("tg-spoiler");
        out.push(...collectInline(children, spoiler ? { ...style, spoiler: true } : style));
        break;
      }
      case "a": {
        const href = sanitizeUrl(attribs.href);
        out.push(...collectInline(children, href ? { ...style, href } : style));
        break;
      }
      case "img": {
        // Картинку внутрь текста Telegram не вставит: оставляем подпись
        // ссылкой на источник, чтобы читатель мог её открыть
        const src = sanitizeUrl(attribs.src);
        const alt = (attribs.alt || "").trim();
        const label = alt || src || "";
        text(label, src ? { ...style, href: src } : style);
        break;
      }
      case "input":
        if ((attribs.type || "").toLowerCase() === "checkbox") {
          text("checked" in attribs ? "☑" : "☐");
        }
        break;
      case "ul":
      case "ol":
        newline();
        out.push(...collectList(node, style, 0));
        newline();
        break;
      case "pre":
        newline();
        text(collectPre(node).text, { ...style, code: true });
        newline();
        break;
      case "table":
        newline();
        text(renderTable(node), { ...style, code: true });
        newline();
        break;
      case "hr":
        newline();
        break;
      default:
        if (HEADING_TAGS.has(name)) {
          newline();
          out.push(...collectInline(children, { ...style, bold: true }));
          newline();
          break;
        }
        if (BLOCK_TAGS.has(name) || name === "blockquote") {
          newline();
          out.push(...collectInline(children, style));
          newline();
          break;
        }
        // Неизвестный инлайн-тег: тег выбрасываем, текст оставляем
        out.push(...collectInline(children, style));
    }
  }
  return out;
};

/**
 * Список в строки с маркерами. Вложенные списки получают отступ по уровню,
 * нумерация учитывает атрибут start.
 */
const collectList = (list: DomNode, style: Style, depth: number): TextRun[] => {
  const ordered = tagName(list) === "ol";
  let index = parseInt((list.attribs || {}).start || "1", 10) || 1;
  const out: TextRun[] = [];
  const items = (list.children || []).filter(
    (node) => isElement(node) && tagName(node) === "li"
  );
  for (const item of items) {
    if (out.length) {
      out.push({ text: "\n" });
    }
    const marker = ordered ? `${index}. ` : BULLET;
    index += 1;
    out.push({ text: LIST_INDENT.repeat(depth) + marker });
    const content: TextRun[] = [];
    let segment: DomNode[] = [];
    const flushSegment = () => {
      if (segment.length) {
        content.push(...collectInline(segment, style));
        segment = [];
      }
    };
    for (const child of item.children || []) {
      const name = isElement(child) ? tagName(child) : "";
      if (name === "ul" || name === "ol") {
        flushSegment();
        content.push({ text: "\n" });
        content.push(...collectList(child, style, depth + 1));
        continue;
      }
      segment.push(child);
    }
    flushSegment();
    out.push(...trimEdges(content));
  }
  return out;
};

const collectPre = (node: DomNode): PreBlock => {
  const findCode = (current: DomNode): DomNode | null => {
    for (const child of current.children || []) {
      if (!isElement(child)) {
        continue;
      }
      if (tagName(child) === "code") {
        return child;
      }
      const nested = findCode(child);
      if (nested) {
        return nested;
      }
    }
    return null;
  };
  const code = findCode(node);
  const match = LANGUAGE_PATTERN.exec((code && code.attribs && code.attribs.class) || "");
  return {
    type: "pre",
    text: textContent(node).replace(/\n$/, ""),
    language: match ? match[1] : "",
  };
};

/**
 * Таблицу Telegram не отобразит, поэтому выравниваем колонки пробелами и
 * отдаём моноширинным блоком: в <pre> ширина символов одинаковая.
 */
const renderTable = (table: DomNode): string => {
  const rows: string[][] = [];
  let headerRows = 0;
  const walk = (node: DomNode, inHead: boolean) => {
    for (const child of node.children || []) {
      if (!isElement(child)) {
        continue;
      }
      const name = tagName(child);
      if (name === "tr") {
        const cells = (child.children || []).filter(
          (cell) => isElement(cell) && (tagName(cell) === "td" || tagName(cell) === "th")
        );
        if (!cells.length) {
          continue;
        }
        rows.push(cells.map((cell) => textContent(cell).replace(/\s+/g, " ").trim()));
        const isHeader = inHead || cells.every((cell) => tagName(cell) === "th");
        if (isHeader && headerRows === rows.length - 1) {
          headerRows = rows.length;
        }
        continue;
      }
      if (name === "thead" || name === "tbody" || name === "tfoot") {
        walk(child, name === "thead");
      }
    }
  };
  walk(table, false);
  if (!rows.length) {
    return "";
  }
  const columns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, i) =>
    Math.max(...rows.map((row) => charCount(row[i] || "")))
  );
  const pad = (value: string, width: number) =>
    value + " ".repeat(Math.max(0, width - charCount(value)));
  const lines: string[] = [];
  rows.forEach((row, i) => {
    lines.push(
      widths.map((width, j) => pad(row[j] || "", width)).join(" | ").replace(/\s+$/, "")
    );
    if (i + 1 === headerRows) {
      lines.push(widths.map((width) => "-".repeat(width)).join("-+-"));
    }
  });
  return lines.join("\n");
};

const paragraph = (runs: TextRun[]): ParagraphBlock => ({
  type: "paragraph",
  runs: normalizeRuns(runs),
});

/**
 * Цитата: вложенные блоки сплющиваются в один, потому что Telegram не
 * допускает blockquote внутри blockquote; код внутри цитаты становится
 * инлайновым <code>, так как <pre> в цитате тоже запрещён.
 */
const collectBlockquote = (
  children: DomNode[],
  style: Style,
  expandable: boolean
): BlockquoteBlock => {
  const inner = new BlockCollector();
  collectBlocks(children, inner, style);
  inner.flush();
  const runs: TextRun[] = [];
  for (const block of inner.blocks) {
    if (runs.length) {
      runs.push({ text: "\n" });
    }
    if (block.type === "pre") {
      runs.push({ text: block.text, code: true });
      continue;
    }
    runs.push(...block.runs);
  }
  return { type: "blockquote", runs: normalizeRuns(runs), expandable };
};

const collectBlocks = (nodes: DomNode[], collector: BlockCollector, style: Style) => {
  for (const node of nodes) {
    if (isText(node)) {
      const data = node.data || "";
      if (data.trim()) {
        collector.inline([{ ...style, text: data }]);
      } else if (collector.hasPending) {
        // Пробел между инлайновыми соседями значим, между блоками — нет
        collector.inline([{ text: data }]);
      }
      continue;
    }
    if (!isElement(node)) {
      continue;
    }
    const name = tagName(node);
    const children = node.children || [];
    const attribs = node.attribs || {};
    if (SKIP_TAGS.has(name)) {
      continue;
    }
    if (HEADING_TAGS.has(name)) {
      collector.push(paragraph(collectInline(children, { ...style, bold: true })));
      continue;
    }
    switch (name) {
      case "p":
        collector.push(paragraph(collectInline(children, style)));
        break;
      case "ul":
      case "ol":
        collector.push(paragraph(collectList(node, style, 0)));
        break;
      case "blockquote":
        collector.push(collectBlockquote(children, style, "expandable" in attribs));
        break;
      case "pre":
        collector.push(collectPre(node));
        break;
      case "table":
        collector.push({ type: "pre", text: renderTable(node), language: "" });
        break;
      case "hr":
        // Горизонтальной линии в Telegram нет: оставляем только границу абзацев
        collector.flush();
        break;
      case "br":
        collector.inline([{ text: "\n" }]);
        break;
      default:
        if (BLOCK_TAGS.has(name)) {
          collector.flush();
          collectBlocks(children, collector, style);
          collector.flush();
          break;
        }
        collector.inline(collectInline([node], style));
    }
  }
};

/**
 * Один отрезок в HTML. Порядок обёрток фиксирован (a > b > i > u > s > spoiler),
 * code исключает остальные стили: Telegram не допускает другие сущности
 * внутри code и code внутри других сущностей.
 */
const runToHtml = (run: TextRun): string => {
  const text = escapeHtml(run.text);
  if (run.code) {
    return `<code>${text}</code>`;
  }
  if (!run.text.trim()) {
    return text;
  }
  let html = text;
  if (run.spoiler) {
    html = `<spoiler>${html}</spoiler>`;
  }
  if (run.strike) {
    html = `<s>${html}</s>`;
  }
  if (run.underline) {
    html = `<u>${html}</u>`;
  }
  if (run.italic) {
    html = `<i>${html}</i>`;
  }
  if (run.bold) {
    html = `<b>${html}</b>`;
  }
  if (run.href) {
    html = `<a href="${escapeAttr(run.href)}">${html}</a>`;
  }
  return html;
};

const blockToHtml = (block: TextBlock): string => {
  if (block.type === "pre") {
    const text = escapeHtml(block.text);
    if (block.language) {
      return `<pre><code class="language-${escapeAttr(block.language)}">${text}</code></pre>`;
    }
    return `<pre>${text}</pre>`;
  }
  const html = block.runs.map(runToHtml).join("");
  if (block.type === "blockquote") {
    return block.expandable
      ? `<blockquote expandable>${html}</blockquote>`
      : `<blockquote>${html}</blockquote>`;
  }
  return html;
};

const blocksToHtml = (blocks: TextBlock[]) => blocks.map(blockToHtml).join(SEPARATOR);

// Длина блока в символах видимого текста: именно её Telegram сравнивает с
// лимитом сообщения, теги в длину не входят
const blockLength = (block: TextBlock) =>
  block.type === "pre" ? block.text.length : runsLength(block.runs);

/**
 * Точка разреза текста в пределах limit: предпочтительно по переносу строки,
 * затем по пробелу, но не раньше половины лимита, чтобы не плодить огрызки.
 */
const findBreak = (text: string, limit: number): number => {
  const slice = text.slice(0, limit);
  const minimum = Math.floor(limit / 2);
  const newline = slice.lastIndexOf("\n");
  if (newline >= minimum) {
    return newline + 1;
  }
  const space = slice.lastIndexOf(" ");
  if (space >= minimum) {
    return space + 1;
  }
  return limit;
};

const splitRuns = (runs: TextRun[], limit: number): TextRun[][] => {
  const pieces: TextRun[][] = [];
  let current: TextRun[] = [];
  let length = 0;
  const queue = [...runs];
  while (queue.length) {
    const run = queue.shift()!;
    const room = limit - length;
    if (run.text.length <= room) {
      current.push(run);
      length += run.text.length;
      continue;
    }
    // Места почти не осталось: не режем отрезок ради пары символов, а
    // начинаем новый кусок целиком с него
    if (current.length && room < Math.floor(limit / 4)) {
      pieces.push(current);
      current = [];
      length = 0;
      queue.unshift(run);
      continue;
    }
    const cut = findBreak(run.text, room);
    current.push({ ...run, text: run.text.slice(0, cut) });
    pieces.push(current);
    current = [];
    length = 0;
    queue.unshift({ ...run, text: run.text.slice(cut) });
  }
  if (current.length) {
    pieces.push(current);
  }
  return pieces;
};

const splitBlock = (block: TextBlock, limit: number): TextBlock[] => {
  if (blockLength(block) <= limit) {
    return [block];
  }
  if (block.type === "pre") {
    const pieces: TextBlock[] = [];
    let rest = block.text;
    while (rest.length > limit) {
      const cut = findBreak(rest, limit);
      pieces.push({ ...block, text: rest.slice(0, cut).replace(/\n$/, "") });
      rest = rest.slice(cut);
    }
    if (rest.trim()) {
      pieces.push({ ...block, text: rest });
    }
    return pieces;
  }
  return splitRuns(block.runs, limit)
    .map((runs) => ({ ...block, runs: normalizeRuns(runs) }) as TextBlock)
    .filter((piece) => !isEmptyBlock(piece));
};

/**
 * Раскладывает блоки по сообщениям не длиннее limit символов видимого текста.
 * Блок, не влезающий целиком, режется по отрезкам, так что ни один тег не
 * оказывается разорванным между сообщениями.
 */
const splitBlocks = (blocks: TextBlock[], limit: number): TextBlock[][] => {
  const safeLimit = Math.max(1, Math.floor(limit));
  const chunks: TextBlock[][] = [];
  let current: TextBlock[] = [];
  let length = 0;
  for (const block of blocks) {
    for (const piece of splitBlock(block, safeLimit)) {
      const size = blockLength(piece);
      if (current.length && length + SEPARATOR.length + size > safeLimit) {
        chunks.push(current);
        current = [];
        length = 0;
      }
      current.push(piece);
      length += (current.length > 1 ? SEPARATOR.length : 0) + size;
    }
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
};

export class MarkdownService {
  readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  /**
   * Markdown в «сырой» HTML от marked, ещё со всеми тегами (p, ul, h1...).
   */
  public renderHtml = async (markdown: string): Promise<string> => {
    const marked = await getMarked();
    return String(await marked.parse(markdown || ""));
  };

  /**
   * Любой HTML в блоки: остаётся только то, что Telegram умеет показать.
   */
  public htmlToBlocks = async (html: string): Promise<TextBlock[]> => {
    const parseDocument = await getParseDocument();
    const document = parseDocument(html || "");
    const collector = new BlockCollector();
    collectBlocks(document.children as unknown as DomNode[], collector, {});
    collector.flush();
    return collector.blocks;
  };

  public markdownToBlocks = async (markdown: string): Promise<TextBlock[]> => {
    return await this.htmlToBlocks(await this.renderHtml(markdown));
  };

  public blocksToHtml = (blocks: TextBlock[]): string => {
    return blocksToHtml(blocks);
  };

  /**
   * Markdown в HTML только с тегами, которые принимает Telegram
   * (b, i, u, s, spoiler, code, pre, blockquote, a).
   */
  public markdownToHtml = async (markdown: string): Promise<string> => {
    this.loggerService.log("markdownService markdownToHtml", {
      length: (markdown || "").length,
    });
    return blocksToHtml(await this.markdownToBlocks(markdown));
  };

  /**
   * Markdown в список HTML-сообщений, каждое не длиннее limit символов
   * видимого текста. Пустой Markdown даёт пустой список.
   */
  public markdownToChunks = async (markdown: string, limit: number): Promise<string[]> => {
    this.loggerService.log("markdownService markdownToChunks", {
      length: (markdown || "").length,
      limit,
    });
    const blocks = await this.markdownToBlocks(markdown);
    return splitBlocks(blocks, limit)
      .map(blocksToHtml)
      .filter((chunk) => chunk.trim());
  };
}

export default MarkdownService;
