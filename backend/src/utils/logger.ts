import { pino, Logger } from 'pino';
import { config } from '../config.js';

export const logger: Logger = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: config.NODE_ENV === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    service: 'polymarket-tracker',
  },
  formatters: {
    level: (label: string) => ({ level: label }),
  },
});

export const createChildLogger = (name: string): Logger => logger.child({ module: name });
