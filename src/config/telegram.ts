import { singleshot } from "functools-kit";
import { getConfig } from "./params";
import { readFile } from "fs/promises";
import { lib } from "../lib";
import { createTelegramLogger } from "./logger";

export const getTelegram = singleshot(async () => {
    try {
        // Ленивый импорт: у gramjs нет exports-карты, подпути в ESM резолвятся
        // только по полному пути с расширением
        const { TelegramClient } = await import("telegram");
        const { StringSession } = await import("telegram/sessions/index.js");
        lib.loggerService.log("getTelegram connect");
        const { CC_TELEGRAM_API_ID, CC_TELEGRAM_API_HASH } = getConfig();
        const session = await readFile("./session.txt", "utf-8");
        const stringSession = new StringSession(session);
        const client = new TelegramClient(stringSession, CC_TELEGRAM_API_ID, CC_TELEGRAM_API_HASH, {
            connectionRetries: 5,
            systemVersion: "Windows 10",
            deviceModel: "Desktop",
            appVersion: "1.0.0",
            baseLogger: await createTelegramLogger(),
        });
        {
            await client.connect();
            await client.getMe();
        }
        return client;
    } catch (error) {
        lib.loggerService.log(`getTelegram failed: no session found. Please run 'require("telegram-writer").signIn()' to create a session.`, error);
        throw error;
    }
});
