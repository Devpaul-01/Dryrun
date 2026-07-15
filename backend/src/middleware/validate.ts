import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import { ApiError } from '../lib/apiError';

interface ValidationTargets {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Step 8 of the global middleware stack.
 *
 * Validates body/query/params against a schema before the handler runs,
 * returning the standard VALIDATION_ERROR shape uniformly. This is what
 * removes the ad hoc, inconsistent per-handler validation that otherwise
 * accumulates over time (e.g., the old pattern of `if (!content?.trim())`
 * scattered inline).
 *
 * Also enforces request body size sanity for free-text fields prone to
 * prompt-stuffing abuse (persona-source pasted text, session messages) —
 * the relevant schemas apply `.max()` constraints; this middleware is what
 * turns a schema violation into a clean 400 rather than an oversized
 * payload reaching the AI layer.
 */
export function validate(targets: ValidationTargets) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (targets.body) {
        req.body = targets.body.parse(req.body);
      }
      if (targets.query) {
        req.query = targets.query.parse(req.query) as typeof req.query;
      }
      if (targets.params) {
        req.params = targets.params.parse(req.params) as typeof req.params;
      }
      next();
    } catch (err: any) {
      next(
        ApiError.badRequest('Request validation failed.', {
          issues: err?.issues ?? String(err),
        })
      );
    }
  };
}
