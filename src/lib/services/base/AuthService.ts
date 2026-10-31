import readline from "readline";
import { writeFile } from "fs/promises";
import qrcodeTerminal from "qrcode-terminal";
import { getConfig } from "../../../config/params";
import { inject } from "../../core/di";
import LoggerService from "../base/LoggerService";
import TYPES from "../../core/types";

const HANDLE_SIGNIN_FN = async () => {

    // Ленивый импорт: у gramjs нет exports-карты, подпути в ESM резолвятся
    // только по полному пути с расширением
    const { TelegramClient } = await import("telegram");
    const { StringSession } = await import("telegram/sessions/index.js");

    const { CC_TELEGRAM_API_ID, CC_TELEGRAM_API_HASH } = getConfig();

    const stringSession = new StringSession("");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const client = new TelegramClient(stringSession, CC_TELEGRAM_API_ID, CC_TELEGRAM_API_HASH, {
        connectionRetries: 5,
        systemVersion: "Windows 10",
        deviceModel: "Desktop",
        appVersion: "1.0.0",
    });

    await client.connect();

    await client.signInUserWithQrCode(
        { apiId: CC_TELEGRAM_API_ID, apiHash: CC_TELEGRAM_API_HASH },
        {
            qrCode: async ({ token }) => {
                const url = `tg://login?token=${token.toString("base64url")}`;
                console.clear();
                console.log("Scan this QR code in Telegram app (Settings -> Devices -> Link Desktop Device):\n");
                qrcodeTerminal.generate(url, { small: true });
            },
            password: async () =>
                new Promise((resolve) =>
                    rl.question("Enter your 2FA password: ", resolve)
                ),
            onError: async (err) => {
                console.error(err.message);
                return false;
            },
        }
    );

    console.log("Connected!");
    {
        const sessionString = stringSession.save();
        await writeFile("./session.txt", sessionString, "utf-8");
    }
    console.log("Session saved to ./session.txt");

    rl.close();
}

export class AuthService {

    readonly loggerService = inject<LoggerService>(TYPES.loggerService);

    public signIn = async () => {
        this.loggerService.log("authService signIn");
        await HANDLE_SIGNIN_FN();
    }
}

export default AuthService;
