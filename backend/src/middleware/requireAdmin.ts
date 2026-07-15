import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/apiError';
import { supabaseAdmin } from '../config/supabase';
import { env } from '../config/env';

/**
 * Two independent layers, per architecture doc §5.17/§24:
 *  1. An optional IP allowlist (ADMIN_ALLOWLIST_IPS) as a coarse network-level check.
 *  2. The authenticated user must have `is_admin = true` on their profile.
 * Both must pass if the allowlist is configured; only #2 is required if it's empty
 * (e.g., in an environment where network-level restriction is handled upstream
 * by the hosting platform instead).
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (env.adminAllowlistIps.length > 0 && !env.adminAllowlistIps.includes(req.ip ?? '')) {
      throw ApiError.forbidden();
    }
    if (!req.user) throw ApiError.unauthorized();

    const { data } = await supabaseAdmin().from('users').select('is_admin').eq('id', req.user.id).single();
    if (!data?.is_admin) throw ApiError.forbidden();

    next();
  } catch (err) {
    next(err);
  }
}
