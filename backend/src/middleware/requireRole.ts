import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/apiError';
import { WorkspaceRole } from './resolveWorkspace';

/**
 * Step 6 of the global middleware stack.
 *
 * Declarative role gate — `requireRole('owner', 'admin')` — used for
 * workspace-management routes (invites, billing, member removal). Never an
 * inline `if (role !== 'owner')` scattered per-handler.
 *
 * Note: this is the coarse role check only. The actual data-isolation
 * guarantee (a member never seeing another member's raw transcript,
 * regardless of role) is enforced at the RLS/query layer, not here — see
 * modules/practice for how session/message queries are scoped.
 */
export function requireRole(...allowed: WorkspaceRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.workspace) {
      next(ApiError.unauthorized());
      return;
    }
    if (!allowed.includes(req.workspace.role)) {
      next(ApiError.forbidden(`This action requires one of these roles: ${allowed.join(', ')}.`));
      return;
    }
    next();
  };
}
