import { NextFunction, Request, Response } from 'express';

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Wraps an async route handler so a rejected promise is forwarded to
 * Express's error pipeline (and ultimately the terminal errorHandler
 * middleware) instead of crashing the process or hanging the request.
 */
export const asyncHandler = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
