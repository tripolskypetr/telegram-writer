import lib from "../lib";

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
export async function signIn() {
    lib.loggerService.log("functions.signIn");
    return await lib.telegramGlobalService.signIn();
}
