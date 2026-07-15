import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { anonymousActionRateLimit } from '../../middleware/rateLimit';
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { env } from '../../config/env';
import * as authService from './auth.service';
import {
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
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

router.post(
  '/refresh',
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
  asyncHandler(async (req, res) => {
    const token = req.headers.authorization!.slice(7);
    await supabaseAdmin().auth.admin.signOut(token, 'local');
    res.json({ success: true });
  })
);

router.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    await authService.logoutAllSessions(req.user!.id);
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

router.post(
  '/reset-password',
  validate({ body: resetPasswordSchema }),
  asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body.token, req.body.newPassword);
    res.json({ success: true });
  })
);

router.post(
  '/verify-email',
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
