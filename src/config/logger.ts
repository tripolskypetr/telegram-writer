import { singleshot } from "functools-kit";
import { lib } from "../lib";

/**
 * Перенаправляет внутренние логи gramjs (TelegramClient) в lib.loggerService
 * вместо stdout. По умолчанию LoggerService содержит noop-логгер, так что
 * клиент молчит, пока потребитель не вызовет setLogger.
 *
 * Модуль telegram/extensions/Logger не имеет exports-карты, в ESM он
 * резолвится только по полному пути с расширением, поэтому грузим его
 * лениво через await import.
 *
 * Вместо class extends — Reflect.construct с переопределением log на
 * инстансе: анонимный класс с приватными полями Logger не попадает в
 * публичный тип фабрики, иначе declaration emit падает с TS4094.
 */
export const createTelegramLogger = singleshot(async () => {
  const { Logger, LogLevel } = await import("telegram/extensions/Logger.js");

  const logger = Reflect.construct(Logger, [LogLevel.INFO]);

  logger.log = (level: any, message: string, _color: string) => {
    if (level === LogLevel.ERROR || level === LogLevel.WARN) {
      lib.loggerService.warn(`telegram ${level}`, message);
      return;
    }
    if (level === LogLevel.DEBUG) {
      lib.loggerService.debug(`telegram ${level}`, message);
      return;
    }
    lib.loggerService.info(`telegram ${level}`, message);
  };

  return logger;
});
