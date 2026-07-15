import { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { ApiError } from '../lib/apiError';
import { createLogger } from '../config/logger';

const log = createLogger('auth-middleware');

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string | null;
  currentWorkspaceId: string | null;
  emailVerifiedAt: string | null;
  onboardingCompletedAt: string | null;
  deletedAt: string | null;
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
 */
const VERIFICATION_EXEMPT_PATHS = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
  '/api/v1/auth/logout-all',
  '/api/v1/auth/verify-email',
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

    const { data: profile, error: profileError } = await supabaseAdmin()
      .from('users')
      .select('id, email, display_name, current_workspace_id, email_verified_at, onboarding_completed_at, deleted_at')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      log.warn({ userId: authUser.id }, 'Valid JWT but no profile row found');
      throw ApiError.notFound('Account not found. Please contact support.');
    }

    if (profile.deleted_at) {
      throw new ApiError(403, 'ACCOUNT_DELETED', 'This account has been deleted.');
    }

    req.user = {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      currentWorkspaceId: profile.current_workspace_id,
      emailVerifiedAt: profile.email_verified_at,
      onboardingCompletedAt: profile.onboarding_completed_at,
      deletedAt: profile.deleted_at,
    };

    const isExemptPath = VERIFICATION_EXEMPT_PATHS.has(req.path);
    if (!req.user.emailVerifiedAt && !isExemptPath) {
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
