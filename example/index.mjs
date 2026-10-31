import { readFile } from "fs/promises";
import { sendMessage } from "telegram-writer";

// Usage: node example/index.mjs [photo.jpg ...]
// Sends a sample post to "Saved Messages" (or to $CHAT) with the given photos.

const CHAT = process.env.CHAT ?? "me";

const CONTENT = `
# Daily report — BTCUSDT

**Bias:** _long_ · Confidence: ~~low~~ **high**

- Entry: \`68 400\`
- Stop: \`67 900\`
- Targets:
  - \`69 200\`
  - \`70 000\`

> Signal taken from [crypto_yoda_channel](https://t.me/crypto_yoda_channel)

| Symbol  | Side | PnL   |
|---------|------|-------|
| BTCUSDT | long | +1.2% |
| ETHUSDT | flat | 0.0%  |

\`\`\`json
{ "symbol": "BTCUSDT", "side": "long" }
\`\`\`
`;

const photos = await Promise.all(process.argv.slice(2).map((path) => readFile(path)));

const sent = await sendMessage({ chat: CHAT, content: CONTENT, photos });

for (const m of sent) {
  console.log(`sent id=${m.id} chat=${m.chat} date=${m.date.toISOString()}`);
}

process.exit(0);
