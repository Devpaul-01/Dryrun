import { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { ApiError } from '../lib/apiError';
import { createLogger } from '../config/logger';

const log = createLogger('auth-middleware');

/**
 * FIX (BACKEND_API_RECOMMENDATIONS.md finding B1): this shape used to be
 * camelCase and only 7 fields, while PATCH /user/me returned the raw
 * `users` row (snake_case, 9 fields, including is_admin/updated_at which
 * this interface omitted entirely) — two different `User` shapes for what
 * should be the single most central object in a frontend's client-side
 * state. Now matches the raw `users` table row shape exactly (snake_case,
 * every column PATCH /user/me already returns), so both endpoints — and
 * any future one that returns "the current user" — share one type.
 *
 * is_admin is included here deliberately for SHAPE CONSISTENCY only, not
 * as a new trust boundary: middleware/requireAdmin.ts intentionally does
 * NOT read this field — it re-queries is_admin fresh from the database on
 * every single admin request, specifically so a just-revoked admin is
 * blocked immediately rather than after their token's next refresh. That
 * behavior is unchanged by this fix; req.user.is_admin exists for the
 * frontend to display/branch on, not for any backend authorization check
 * to rely on.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  display_name: string | null;
  current_workspace_id: string | null;
  email_verified_at: string | null;
  onboarding_completed_at: string | null;
  is_admin: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Routes a not-yet-verified user is still allowed to hit, so they can
 * actually complete verification and aren't locked out of the app entirely
 * with no way forward.
 *
 * FIX (CRIT-6): '/api/v1/auth/verify-email' removed from this set — that
 * route never runs `authenticate` at all (see auth.routes.ts), so its
 * presence here was dead configuration that could never matter either way.
 */
const VERIFICATION_EXEMPT_PATHS = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/auth/logout-all',
  '/api/v1/auth/resend-verification',
]);

/**
 * Step 4 of the global middleware stack.
 *
 * Verifies the Supabase-issued JWT, loads the corresponding `public.users`
 * profile, and attaches it to `req.user`.
 *
 * IMPORTANT — email verification is BLOCKING for every account type,
 * including Google OAuth signups. This is a deliberate departure from the
 * original architecture doc (which treated verification as non-blocking),
 * per an explicit product decision: Google OAuth users must also confirm
 * through DryRun's own verification email before they can use the product,
 * not just rely on Google having already verified the address on its side.
 * See modules/auth/auth.service.ts for how the verification token/email
 * flow itself works.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Authentication required. Please log in.');
    }
    const token = authHeader.slice(7);

    const {
      data: { user: authUser },
      error,
    } = await supabaseAdmin().auth.getUser(token);

    if (error || !authUser) {
      throw ApiError.unauthorized('Session expired. Please log in again.');
    }

    // FIX (BACKEND_API_RECOMMENDATIONS.md finding B1): select('*') instead
    // of an explicit column list — this is the same "authenticated user"
    // row PATCH /user/me already returns via its own select('*'), so
    // widening this query is what makes the two shapes match exactly
    // going forward, including any future column added to `users`.
    const { data: profile, error: profileError } = await supabaseAdmin()
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      log.warn({ userId: authUser.id }, 'Valid JWT but no profile row found');
      throw ApiError.notFound('Account not found. Please contact support.');
    }

    if (profile.deleted_at) {
      throw new ApiError(403, 'ACCOUNT_DELETED', 'This account has been deleted.');
    }

    req.user = profile as AuthenticatedUser;

    // FIX (CRIT-6): `req.path` alone is relative to wherever this
    // middleware happens to be mounted (e.g. '/logout', not
    // '/api/v1/auth/logout') — empirically confirmed with a standalone
    // Express test, not just reasoned through. Compared against the
    // full-path strings in VERIFICATION_EXEMPT_PATHS, that comparison
    // never matched under this app's actual mount structure, meaning an
    // unverified user was incorrectly blocked from logout, logout-all,
    // resend-verification, and GET /me — exactly the routes meant to let
    // them get unstuck. `req.baseUrl + req.path` reconstructs the full,
    // mount-independent path; middleware/rateLimit.ts already uses this
    // same pattern for its own keying, for the identical reason.
    const isExemptPath = VERIFICATION_EXEMPT_PATHS.has(req.baseUrl + req.path);
    if (!req.user.email_verified_at && !isExemptPath) {
      throw new ApiError(
        403,
        'EMAIL_NOT_VERIFIED',
        'Please verify your email address to continue. Check your inbox, or request a new verification email.'
      );
    }

    next();
  } catch (err) {
    next(err);
  }
}
