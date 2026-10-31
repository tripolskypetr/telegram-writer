const baseServices = {
    authService: Symbol('authService'),
    loggerService: Symbol('loggerService'),
    markdownService: Symbol('markdownService'),
    writerService: Symbol('writerService'),
};

const globalServices = {
    telegramGlobalService: Symbol('telegramGlobalService'),
}

export const TYPES = {
    ...baseServices,
    ...globalServices,
}

export default TYPES;
