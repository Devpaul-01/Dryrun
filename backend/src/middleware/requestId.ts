import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Step 1 of the global middleware stack. Every request gets an x-request-id,
 * generated if not already supplied by the caller. This ID is attached to
 * every log line for this request and threaded into any background job
 * enqueued as a consequence of it, so a debrief job can be traced back to
 * the exact request that triggered it (architecture doc §0.5 / §18).
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
