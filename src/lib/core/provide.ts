import { provide } from "./di";
import TYPES from "./types";

import AuthService from "../services/base/AuthService";
import LoggerService from "../services/base/LoggerService";
import MarkdownService from "../services/base/MarkdownService";
import WriterService from "../services/base/WriterService";

import TelegramGlobalService from "../services/global/TelegramGlobalService";

{
    provide(TYPES.authService, () => new AuthService());
    provide(TYPES.loggerService, () => new LoggerService());
    provide(TYPES.markdownService, () => new MarkdownService());
    provide(TYPES.writerService, () => new WriterService());
}

{
    provide(TYPES.telegramGlobalService, () => new TelegramGlobalService());
}
