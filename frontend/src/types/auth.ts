/**
 * Wire shapes specific to auth responses — verified directly against
 * backend/src/modules/auth/auth.routes.ts and auth.schemas.ts, not just
 * the architecture doc, since several of these diverge from what a
 * "standard" auth API would return:
 *
 * - POST /auth/signup does NOT return tokens. Email verification is
 *   blocking (see authenticate.ts) — the account exists but can't log in
 *   until verified, so there is no session to issue yet.
 * - POST /auth/login and /auth/recover-account return raw session fields
 *   ONLY (access_token/refresh_token/expires_at) — no `user` object. A
 *   separate GET /auth/me call is required to get the user.
 * - GET /auth/me (and PATCH /user/me) wrap the user in { user: ... }.
 * - POST /auth/google/callback returns only a success message, never
 *   tokens — the mobile session comes directly from Supabase's client SDK
 *   via expo-auth-session, independent of this backend call entirely.
 */

import type { User } from './api';

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export interface SignupResponse {
  success: true;
  user_id: string;
  message: string;
}

export type LoginResponse = AuthSession;
export type RefreshResponse = AuthSession;
export type RecoverAccountResponse = AuthSession;

export interface MeResponse {
  user: User;
}

export interface SuccessMessageResponse {
  success: true;
  message?: string;
}

export interface GoogleCallbackResponse {
  success: true;
  message: string;
}
