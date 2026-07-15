import { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { ApiError } from '../lib/apiError';
import { createLogger } from '../config/logger';

const log = createLogger('error-handler');

/**
 * Step 10 of the global middleware stack — terminal.
 *
 * The single place the `{ error, message, details }` shape is constructed.
 * No route or service handler ever builds this shape itself; they throw
 * `ApiError` (or let an unexpected error propagate) and this middleware
 * translates it.
 *
 * Every error is logged with the request ID attached so it's correlatable
 * with the Sentry event and with any background job the request enqueued.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      log.error({ err, requestId: req.requestId }, err.message);
      Sentry.captureException(err);
    } else {
      log.warn({ code: err.code, requestId: req.requestId }, err.message);
    }
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  log.error({ err, requestId: req.requestId }, 'Unhandled error');
  Sentry.captureException(err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'Something went wrong on our end. Please try again.',
  });
}
