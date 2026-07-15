import pinoHttp from 'pino-http';
import { logger } from '../config/logger';
import { Request } from 'express';

/**
 * Step 12 of the global middleware stack (steps 9/11 — handler execution and
 * metrics — are the route handler itself and Sentry Performance respectively;
 * see errorHandler.ts for step 10).
 *
 * Structured request/response logging: method, path, status, duration,
 * user/workspace ID, and request ID on every line.
 */
export const requestLogging = pinoHttp({
  logger,
  customProps: (req: Request) => ({
    requestId: req.requestId,
    userId: req.user?.id,
    workspaceId: req.workspace?.id,
  }),
  autoLogging: {
    ignore: (req) => req.url === '/health' || req.url === '/health/ready',
  },
});
