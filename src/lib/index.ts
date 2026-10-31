import "./core/provide";
import { inject, init } from "./core/di";
import TYPES from "./core/types";

import AuthService from "./services/base/AuthService";
import LoggerService from "./services/base/LoggerService";
import MarkdownService from "./services/base/MarkdownService";
import WriterService from "./services/base/WriterService";

import TelegramGlobalService from "./services/global/TelegramGlobalService";

const baseServices = {
  authService: inject<AuthService>(TYPES.authService),
  loggerService: inject<LoggerService>(TYPES.loggerService),
  markdownService: inject<MarkdownService>(TYPES.markdownService),
  writerService: inject<WriterService>(TYPES.writerService),
};

const globalServices = {
  telegramGlobalService: inject<TelegramGlobalService>(TYPES.telegramGlobalService),
};

export const lib = {
  ...baseServices,
  ...globalServices,
};

init();

export default lib;
