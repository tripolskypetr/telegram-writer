import { inject } from "../../core/di";
import LoggerService from "../base/LoggerService";
import TYPES from "../../core/types";
import AuthService from "../base/AuthService";
import WriterService from "../base/WriterService";

export class TelegramGlobalService {

    readonly loggerService = inject<LoggerService>(TYPES.loggerService);
    readonly authService = inject<AuthService>(TYPES.authService);
    readonly writerService = inject<WriterService>(TYPES.writerService);

    public signIn = async () => {
        this.loggerService.log("telegramGlobalService signIn");
        await this.authService.signIn();
    }

    public sendMessage = async (dto: {
        chat: string;
        content: string;
        photos?: Array<string | Buffer>;
        silent?: boolean;
        replyTo?: number;
        linkPreview?: boolean;
    }) => {
        this.loggerService.log("telegramGlobalService sendMessage", {
            chat: dto.chat,
            length: (dto.content || "").length,
            photos: (dto.photos || []).length,
        });
        return await this.writerService.sendMessage(dto);
    }
}

export default TelegramGlobalService;
