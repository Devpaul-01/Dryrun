import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { anonymousActionRateLimit } from '../../middleware/rateLimit';
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { env } from '../../config/env';
import * as authService from './auth.service';
import * as pushService from '../notifications/push.service';
import {
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  recoverAccountSchema,
  logoutSchema,
} from './auth.schemas';

const router = Router();

router.post(
  '/signup',
  anonymousActionRateLimit,
  validate({ body: signupSchema }),
  asyncHandler(async (req, res) => {
    const { email, password, displayName } = req.body;
    const result = await authService.signup(email, password, displayName);
    res.status(201).json({
      success: true,
      user_id: result.userId,
      message: 'Account created. Check your email to verify your address before logging in.',
    });
  })
);

router.post(
  '/login',
  anonymousActionRateLimit,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabaseAdmin().auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      throw ApiError.unauthorized('Invalid email or password.');
    }
    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    });
  })
);

// FIX (MED-7): this route had no rate limit at all, unlike /login,
// /signup, and /forgot-password — a real gap for an endpoint that hits
// Supabase's auth API on every call.
router.post(
  '/refresh',
  anonymousActionRateLimit,
  asyncHandler(async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) throw ApiError.badRequest('refresh_token is required.');
    const { data, error } = await supabaseAdmin().auth.refreshSession({ refresh_token });
    if (error || !data.session) throw ApiError.unauthorized('Session expired. Please log in again.');
    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    });
  })
);

router.post(
  '/logout',
  authenticate,
  validate({ body: logoutSchema }),
  asyncHandler(async (req, res) => {
    const token = req.headers.authorization!.slice(7);
    await supabaseAdmin().auth.admin.signOut(token, 'local');
    // FIX (mobile-readiness review): see push.service.ts's
    // deregisterPushToken for the full rationale — without this, a push
    // token survived logout indefinitely and a second account logging in
    // on the same device would keep both users receiving each other's
    // notifications. Only this device's own session is being revoked
    // above ('local'), so only its own push token (if the client sent
    // one) is deregistered here — not every token this user has.
    if (req.body?.pushToken) {
      await pushService.deregisterPushToken(req.user!.id, req.body.pushToken);
    }
    res.json({ success: true });
  })
);

router.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    await authService.logoutAllSessions(req.user!.id);
    // Every session is being revoked here, so every push token this user
    // has ever registered goes too — not just the calling device's.
    await pushService.deregisterAllPushTokens(req.user!.id);
    res.json({ success: true });
  })
);

router.post(
  '/forgot-password',
  anonymousActionRateLimit,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(async (req, res) => {
    await authService.forgotPassword(req.body.email);
    // Always return success — no account enumeration.
    res.json({ success: true, message: 'If an account exists for that email, a reset link has been sent.' });
  })
);

// FIX (backend-takeover audit, Task #16 — mobile-readiness review): these
// were the only two anonymous auth routes with no rate limit at all,
// unlike /signup, /login, /refresh, /forgot-password, /resend-verification
// and /recover-account above. Supabase's own verifyOtp is the real
// token-verification boundary (an unguessable token still can't be brute
// forced through unlimited retries here), but with no limit at all these
// endpoints were otherwise open to unbounded request volume from anyone,
// authenticated or not -- the same resource-abuse concern every other
// anonymous route here is already guarded against.
router.post(
  '/reset-password',
  anonymousActionRateLimit,
  validate({ body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body.token, req.body.newPassword);
    res.json({ success: true });
  })
);

router.post(
  '/verify-email',
  anonymousActionRateLimit,
  validate({ body: verifyEmailSchema }),
  asyncHandler(async (req, res) => {
    await authService.verifyEmail(req.body.token);
    res.json({ success: true, message: 'Email verified. You can now log in.' });
  })
);

router.post(
  '/resend-verification',
  authenticate,
  anonymousActionRateLimit,
  asyncHandler(async (req, res) => {
    await authService.resendVerification(req.user!.id, req.user!.email);
    res.json({ success: true });
  })
);

/**
 * FIX (CRIT-7): makes DELETE /user/me's "you have 14 days to recover it
 * by logging back in" promise actually true. Deliberately does NOT use
 * `authenticate` — that middleware unconditionally 403s any request from
 * a user with deleted_at set, which is exactly the account state this
 * route exists to handle. See auth.service.ts#recoverAccount for the
 * real authentication/grace-window logic.
 */
router.post(
  '/recover-account',
  anonymousActionRateLimit,
  validate({ body: recoverAccountSchema }),
  asyncHandler(async (req, res) => {
    const result = await authService.recoverAccount(req.body.email, req.body.password);
    res.json({
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token,
      expires_at: result.session.expires_at,
    });
  })
);

/**
 * Web OAuth redirect start. Mobile clients do not hit this route — they use
 * expo-auth-session directly against Supabase Auth's OAuth endpoint with a
 * platform-computed redirect URI (never this shared constant), per the
 * architecture doc §6.2 / §5.2 of the frontend platform blueprint.
 */
router.get(
  '/google/start',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabaseAdmin().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: env.frontendUrl + '/auth/callback' },
    });
    if (error || !data.url) throw ApiError.internal('Failed to start Google sign-in.');
    res.redirect(data.url);
  })
);

/**
 * Callback: the frontend exchanges the OAuth code via the Supabase client
 * SDK directly in most Supabase Auth setups; this endpoint exists for the
 * server-side finalize step — ensuring the profile/workspace/verification
 * email flow runs exactly once per new identity (auth.service.handleOAuthLogin).
 */
router.post(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const { access_token } = req.body;
    if (!access_token) throw ApiError.badRequest('access_token is required.');

    const {
      data: { user },
      error,
    } = await supabaseAdmin().auth.getUser(access_token);
    if (error || !user) throw ApiError.unauthorized('Invalid Google session.');

    await authService.handleOAuthLogin(
      user.id,
      user.email!,
      (user.user_metadata?.full_name as string) ?? undefined
    );

    res.json({
      success: true,
      message: 'Signed in. Check your email to verify your address before continuing.',
    });
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  })
);

export default router;
