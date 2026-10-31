export interface WriterMessage {
    /** Message id assigned by Telegram within the chat */
    id: number;
    /** Chat exactly as passed in the request */
    chat: string;
    /** Server-side send time */
    date: Date;
}
