import { HttpResponse, http } from 'msw';

import { env } from '@/config/env';

import { mockAuthTokens, mockUser } from '../data';

const API = env.apiRoot;

/**
 * Shapes verified directly against backend/src/modules/auth/auth.routes.ts
 * and auth.schemas.ts (see src/types/auth.ts's header comment for the
 * full rationale) — deliberately NOT the "obvious" shapes a generic auth
 * API would have:
 * - /signup returns no tokens (email verification is blocking).
 * - /login and /recover-account return session fields only, no `user`.
 * - /me wraps the user in { user }.
 * - /google/callback returns a message only — mobile's session comes
 *   from Supabase's client SDK directly, never from this endpoint.
 */
export const authHandlers = [
  http.post(`${API}/auth/signup`, async () => {
    return HttpResponse.json(
      {
        success: true,
        user_id: mockUser.id,
        message: 'Account created. Check your email to verify your address before logging in.',
      },
      { status: 201 },
    );
  }),

  http.post(`${API}/auth/login`, async () => {
    return HttpResponse.json(mockAuthTokens);
  }),

  http.post(`${API}/auth/refresh`, async () => {
    return HttpResponse.json(mockAuthTokens);
  }),

  http.get(`${API}/auth/me`, async () => {
    return HttpResponse.json({ user: mockUser });
  }),

  http.post(`${API}/auth/logout`, async () => {
    return HttpResponse.json({ success: true });
  }),

  http.post(`${API}/auth/logout-all`, async () => {
    return HttpResponse.json({ success: true });
  }),

  http.post(`${API}/auth/forgot-password`, async () => {
    return HttpResponse.json({
      success: true,
      message: 'If an account exists for that email, a reset link has been sent.',
    });
  }),

  http.post(`${API}/auth/reset-password`, async () => {
    return HttpResponse.json({ success: true });
  }),

  http.post(`${API}/auth/verify-email`, async () => {
    return HttpResponse.json({ success: true, message: 'Email verified. You can now log in.' });
  }),

  http.post(`${API}/auth/resend-verification`, async () => {
    return HttpResponse.json({ success: true });
  }),

  http.post(`${API}/auth/recover-account`, async () => {
    return HttpResponse.json(mockAuthTokens);
  }),

  http.post(`${API}/auth/google/callback`, async () => {
    return HttpResponse.json({
      success: true,
      message: 'Signed in. Check your email to verify your address before continuing.',
    });
  }),
];
