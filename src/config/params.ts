declare function parseInt(value: unknown): number;

const GLOBAL_CONFIG = {
  CC_TELEGRAM_API_ID: 0,
  CC_TELEGRAM_API_HASH: "",
  /** Max characters of a plain text message. Telegram hard limit is 4096 */
  CC_TELEGRAM_MESSAGE_LIMIT: 0,
  /** Max characters of a photo caption. Telegram limit is 1024 (4096 for premium accounts) */
  CC_TELEGRAM_CAPTION_LIMIT: 0,
};

export const DEFAULT_CONFIG = Object.freeze({ ...GLOBAL_CONFIG });

export type Config = typeof GLOBAL_CONFIG;

export const getConfig = () => {
  const config = {
    CC_TELEGRAM_API_ID: parseInt(process.env.CC_TELEGRAM_API_ID) || 31861455,
    CC_TELEGRAM_API_HASH: process.env.CC_TELEGRAM_API_HASH || "ca60446c67ce250ee4e789c730163449",
    CC_TELEGRAM_MESSAGE_LIMIT: parseInt(process.env.CC_TELEGRAM_MESSAGE_LIMIT) || 4096,
    CC_TELEGRAM_CAPTION_LIMIT: parseInt(process.env.CC_TELEGRAM_CAPTION_LIMIT) || 1024,
  };
  if (GLOBAL_CONFIG.CC_TELEGRAM_API_ID) {
    config.CC_TELEGRAM_API_ID = GLOBAL_CONFIG.CC_TELEGRAM_API_ID;
  }
  if (GLOBAL_CONFIG.CC_TELEGRAM_API_HASH) {
    config.CC_TELEGRAM_API_HASH = GLOBAL_CONFIG.CC_TELEGRAM_API_HASH;
  }
  if (GLOBAL_CONFIG.CC_TELEGRAM_MESSAGE_LIMIT) {
    config.CC_TELEGRAM_MESSAGE_LIMIT = GLOBAL_CONFIG.CC_TELEGRAM_MESSAGE_LIMIT;
  }
  if (GLOBAL_CONFIG.CC_TELEGRAM_CAPTION_LIMIT) {
    config.CC_TELEGRAM_CAPTION_LIMIT = GLOBAL_CONFIG.CC_TELEGRAM_CAPTION_LIMIT;
  }
  return config;
};

export const setConfig = (config: Partial<Config>) => {
  Object.assign(GLOBAL_CONFIG, config);
};
