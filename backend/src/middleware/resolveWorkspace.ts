import { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { redisConnection } from '../config/redis';
import { ApiError } from '../lib/apiError';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export interface ResolvedWorkspace {
  id: string;
  name: string;
  planId: string;
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

    const requestedWorkspaceId =
      (req.headers['x-workspace-id'] as string | undefined) ?? req.user.currentWorkspaceId;

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
      .select('role, status, workspaces(id, name, plan_id)')
      .eq('user_id', req.user.id)
      .eq('workspace_id', requestedWorkspaceId)
      .maybeSingle();

    if (error || !membership || membership.status !== 'active') {
      throw ApiError.forbidden('You do not have access to this workspace.');
    }

    const ws = membership.workspaces as unknown as { id: string; name: string; plan_id: string };
    const resolved: ResolvedWorkspace = {
      id: ws.id,
      name: ws.name,
      planId: ws.plan_id,
      role: membership.role as WorkspaceRole,
    };

    await redis.set(key, JSON.stringify(resolved), 'EX', CACHE_TTL_SECONDS);
    req.workspace = resolved;
    next();
  } catch (err) {
    next(err);
  }
}
