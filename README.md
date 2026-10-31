# telegram-writer

A library for publishing posts to Telegram chats and channels via MTProto (a userbot built on [gramjs](https://gram.js.org/)). It takes **Markdown and photos** and sends them as a post: the Markdown is converted to HTML and then reduced to the tags Telegram supports, long texts are split into several messages, photos go as albums. A companion to [telegram-reader](https://www.npmjs.com/package/telegram-reader) — the photos it returns can be passed straight back in.

## Features

- **QR-code authorization** — one interactive session, after which the client reuses the saved `session.txt`.
- **`sendMessage`** — Markdown + photos → chat. Photos are sent as albums (up to 10 per album); the text becomes the caption when it fits into the caption limit, otherwise it follows as separate messages.
- **Markdown → Telegram HTML**: `marked` renders the Markdown, `htmlparser2` parses the result, and everything Telegram cannot display is flattened to text. Only `b`, `i`, `u`, `s`, `spoiler`, `code`, `pre`, `blockquote` and `a` survive, so Telegram never sees a tag it would reject (tables, headings, lists, images).
- **Long posts are split** at the message limit (4096 chars) and at the caption limit (1024 chars) between paragraphs or at a line/word boundary — formatting never breaks across messages.
- **Photos** are accepted as base64 (the `telegram-reader` format), data-URLs or `Buffer`s; each is rotated by EXIF, downsized to at most 2560px on the long side and re-encoded as JPEG via `sharp`, so Telegram always treats it as a photo. Processing goes through a pool (`maxExec: 5`) to avoid OOM on weak hardware.

## Installation and build

```bash
npm install
npm run build   # rollup → build/index.cjs, build/index.mjs + types.d.ts
```

Requires Node.js 20+ (`sharp`, `marked` and `htmlparser2` are used).

## Setup

1. Get an `api_id` and `api_hash` at [my.telegram.org](https://my.telegram.org) and pass them via `setConfig` **before** the first call to any other function (recommended way):

   ```ts
   import { setConfig } from "telegram-writer";

   setConfig({
     CC_TELEGRAM_API_ID: 1234567,
     CC_TELEGRAM_API_HASH: "0123456789abcdef0123456789abcdef",
   });
   ```

   Values set through `setConfig` take priority over everything else. Alternatively, use environment variables (a `.env` file works too):

   ```bash
   CC_TELEGRAM_API_ID=1234567
   CC_TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
   ```

   Resolution order: `setConfig` → environment variables → built-in defaults. The current effective values can be inspected with `getConfig()`.

   Two more keys control splitting: `CC_TELEGRAM_MESSAGE_LIMIT` (default `4096`) and `CC_TELEGRAM_CAPTION_LIMIT` (default `1024`; Telegram Premium accounts may raise it to `4096`).

2. Create `session.txt` by signing in once. The recommended way is a one-liner:

   ```bash
   node -e 'require("telegram-writer").signIn()'
   ```

   Or call it from your own code:

   ```ts
   import { signIn } from "telegram-writer";

   await signIn();
   // Session saved to ./session.txt
   ```

   A QR code appears in the console — scan it in Telegram (*Settings → Devices → Link Desktop Device*); if 2FA is enabled, you will be prompted for the password. The session is saved to `./session.txt` and reused by all subsequent calls.

## Usage

### Send a post

```ts
import { sendMessage } from "telegram-writer";

const sent = await sendMessage({
  chat: "some_channel",            // username, "@username", numeric id as a string, or "me"
  content: "# Report\n\n**BTCUSDT** closed at `68 400`\n\n- long\n- stop `67 900`",
  photos: [chartPngBuffer, base64FromTelegramReader], // optional
  silent: false,                   // optional, do not notify members
  replyTo: 123,                    // optional, message id to reply to
  linkPreview: false,              // optional, defaults to false
});
```

Each returned row describes one sent message, in send order:

```ts
interface WriterMessage {
  id: number;   // message id within the chat
  chat: string; // chat exactly as passed in the request
  date: Date;   // server-side send time
}
```

Delivery rules:

- **No photos** — the text goes as one message, or several when it exceeds `CC_TELEGRAM_MESSAGE_LIMIT`.
- **With photos** — albums of up to 10 photos are sent first. When the text fits `CC_TELEGRAM_CAPTION_LIMIT` it becomes the caption of the first album; otherwise the albums go without a caption and the text follows as separate messages.
- Empty text with no photos sends nothing and returns `[]`.

### How Markdown is converted

Inside `sendMessage` the Markdown is rendered to HTML by `marked`, parsed by `htmlparser2`, and rebuilt so that only Telegram entities remain. Nothing else is ever sent with `parseMode: "html"`.

| Markdown | Telegram |
| --- | --- |
| `**bold**`, `*italic*`, `~~strike~~`, raw `<u>`/`<ins>` | `<b>`, `<i>`, `<s>`, `<u>` |
| `<tg-spoiler>`, `<spoiler>`, `<span class="tg-spoiler">` | `<spoiler>` |
| `` `code` `` | `<code>` (other styles inside are dropped — Telegram forbids them) |
| ```` ```lang ```` fenced block | `<pre><code class="language-lang">` (or plain `<pre>`) |
| `[text](url)`, `<https://url>` | `<a href="url">` — only `http(s)://`, `tg://`, `mailto:`; other links become plain text |
| `![alt](url)` | `<a href="url">alt</a>` — Telegram cannot embed images in text |
| `# Heading` … `###### Heading` | bold line |
| `- item`, `1. item`, `- [x] task` | `• item`, `1. item`, `☑ task` lines; nested lists indented by 4 spaces |
| `> quote` | `<blockquote>` (nested quotes are flattened; raw `<blockquote expandable>` is kept) |
| GFM table | aligned monospace `<pre>` block |
| `---` | paragraph break |
| single newline | line break (`breaks: true`) |
| `<div>`, `<span>`, any other tag | removed, text kept; `<script>`/`<style>` removed with content |

Blocks are separated by a blank line. Identical tags are never nested and `code` never carries other styles, matching Telegram's entity rules.

### Direct client access

```ts
import { getTelegram } from "telegram-writer";

const client = await getTelegram(); // authorized TelegramClient (singleton)
```

## REPL

```bash
npm run repl
```

Builds the project and starts Node with `.env` loaded — handy for testing the functions by hand.
