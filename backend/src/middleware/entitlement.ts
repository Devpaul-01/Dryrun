import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/apiError';
import { ResolvedWorkspace } from './resolveWorkspace';
import { EntitlementResult } from '../modules/billing/entitlements';

/**
 * Step 7 of the global middleware stack.
 *
 * Wraps a named entitlement function (modules/billing/entitlements.ts) as
 * middleware, so every gated route declares its gate at the router level —
 * `router.post('/sessions', entitlement(canStartSession), handler)` — and
 * never re-implements plan-comparison logic inline.
 */
export function entitlement(check: (workspace: ResolvedWorkspace) => Promise<EntitlementResult>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.workspace) {
        throw ApiError.unauthorized();
      }
      const result = await check(req.workspace);
      if (!result.allowed) {
        throw ApiError.featureGate(result.reason ?? 'FEATURE_GATED', result.details);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
