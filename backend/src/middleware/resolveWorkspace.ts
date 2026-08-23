import { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { redisConnection } from '../config/redis';
import { ApiError } from '../lib/apiError';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

/**
 * FIX (HIGH-1): `planId` removed — workspaces.plan_id was never written
 * by any application code path (workspace creation only sets `name`;
 * checkout confirmation only ever updates the SUBSCRIPTION row's
 * plan_id, never the workspace's), so this field was always null and a
 * genuine foot-gun for any caller that reasonably assumed it reflected
 * the workspace's current plan. The real source of truth is, and
 * remains, entitlements.ts's resolveEffectivePlan() /
 * GET /billing/subscription — see db/migrations/0007, which drops the
 * dead column entirely.
 */
export interface ResolvedWorkspace {
  id: string;
  name: string;
  role: WorkspaceRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      workspace?: ResolvedWorkspace;
    }
  }
}

const CACHE_TTL_SECONDS = 30;
const cacheKey = (userId: string, workspaceId: string) => `workspace-ctx:${userId}:${workspaceId}`;

/**
 * Call this whenever workspace membership/role changes (invite accepted,
 * member removed, role changed) so a just-removed member's next request
 * doesn't ride on a stale cached "active" status for up to the TTL window —
 * correctness matters more than the small extra DB read here.
 */
export async function invalidateWorkspaceContextCache(userId: string, workspaceId: string): Promise<void> {
  await redisConnection().del(cacheKey(userId, workspaceId));
}

/**
 * Step 5 of the global middleware stack.
 *
 * Resolves `req.workspace` from the authenticated user's active workspace
 * (or an explicit `x-workspace-id` header, for users belonging to more than
 * one workspace), validates the membership is `active` (not `removed`), and
 * attaches the resolved role for the downstream `requireRole` middleware.
 *
 * This is named and explicit rather than assumed, per the architecture
 * doc's middleware-stack requirement (§0.5) — no handler resolves workspace
 * context on its own.
 */
export async function resolveWorkspace(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      throw ApiError.unauthorized();
    }

    // FIX (BACKEND_API_RECOMMENDATIONS.md finding B1): req.user is now the
    // raw snake_case users row (see middleware/authenticate.ts's
    // AuthenticatedUser) — current_workspace_id, not currentWorkspaceId.
    const requestedWorkspaceId =
      (req.headers['x-workspace-id'] as string | undefined) ?? req.user.current_workspace_id;

    if (!requestedWorkspaceId) {
      throw ApiError.badRequest('No workspace context available for this user.');
    }

    const redis = redisConnection();
    const key = cacheKey(req.user.id, requestedWorkspaceId);
    const cached = await redis.get(key);
    if (cached) {
      req.workspace = JSON.parse(cached) as ResolvedWorkspace;
      next();
      return;
    }

    const { data: membership, error } = await supabaseAdmin()
      .from('workspace_members')
      .select('role, status, workspaces(id, name)')
      .eq('user_id', req.user.id)
      .eq('workspace_id', requestedWorkspaceId)
      .maybeSingle();

    if (error || !membership || membership.status !== 'active') {
      throw ApiError.forbidden('You do not have access to this workspace.');
    }

    const ws = membership.workspaces as unknown as { id: string; name: string };
    const resolved: ResolvedWorkspace = {
      id: ws.id,
      name: ws.name,
      role: membership.role as WorkspaceRole,
    };

    await redis.set(key, JSON.stringify(resolved), 'EX', CACHE_TTL_SECONDS);
    req.workspace = resolved;
    next();
  } catch (err) {
    next(err);
  }
}
