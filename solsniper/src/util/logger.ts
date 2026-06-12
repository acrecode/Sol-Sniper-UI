import pino, { type Logger } from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';
const pretty = process.env.LOG_PRETTY !== 'false';

/**
 * Structured root logger. Redaction is belt-and-suspenders: secret keys must
 * never be passed to the logger in the first place (instructions.md §10), but
 * if one slips into a known field it is censored here.
 */
export const logger: Logger = pino({
  level,
  redact: {
    paths: [
      'privateKey',
      'secretKey',
      'WALLET_PRIVATE_KEY',
      '*.privateKey',
      '*.secretKey',
    ],
    censor: '[REDACTED]',
  },
  ...(pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

export function child(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
