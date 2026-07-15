import pino from 'pino';
import { env } from './env';

/**
 * Structured JSON logging throughout the backend.
 * Every module gets a child logger scoped with its own name so log lines are
 * filterable by subsystem, and every request-scoped log line carries the
 * request ID (attached by the requestId middleware) so a client-reported
 * error can be correlated back to the exact backend request that produced it.
 */
export const logger = pino({
  level: env.logLevel,
  base: { service: 'dryrun-api' },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const createLogger = (scope: string) => logger.child({ scope });
