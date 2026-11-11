import { httpClient } from '@/api/httpClient';
import type {
  ForgotPasswordRequest,
  GoogleCallbackRequest,
  LoginRequest,
  LogoutRequest,
  RecoverAccountRequest,
  ResendVerificationRequest,
  ResetPasswordRequest,
  SignupRequest,
  VerifyEmailRequest,
} from '@/types/requests';
import type {
  GoogleCallbackResponse,
  LoginResponse,
  MeResponse,
  RecoverAccountResponse,
  SignupResponse,
  SuccessMessageResponse,
} from '@/types/auth';

/**
 * Thin wrappers around httpClient for every /auth/* endpoint — one
 * function per endpoint, no business logic here (that lives in
 * src/hooks/useAuth.ts's mutations, which own token/store side effects).
 * Response types are the verified wire shapes from src/types/auth.ts, not
 * the architecture doc's original (partly inaccurate) assumptions — see
 * that file's header comment.
 */

export function signup(body: SignupRequest) {
  return httpClient.post<SignupResponse>('/auth/signup', body).then((res) => res.data);
}

export function login(body: LoginRequest) {
  return httpClient.post<LoginResponse>('/auth/login', body).then((res) => res.data);
}

export function logout(body?: LogoutRequest) {
  return httpClient.post<SuccessMessageResponse>('/auth/logout', body ?? {}).then((res) => res.data);
}

export function logoutAll() {
  return httpClient.post<SuccessMessageResponse>('/auth/logout-all').then((res) => res.data);
}

export function getMe() {
  return httpClient.get<MeResponse>('/auth/me').then((res) => res.data);
}

export function forgotPassword(body: ForgotPasswordRequest) {
  return httpClient
    .post<SuccessMessageResponse>('/auth/forgot-password', body)
    .then((res) => res.data);
}

export function resetPassword(body: ResetPasswordRequest) {
  return httpClient.post<SuccessMessageResponse>('/auth/reset-password', body).then((res) => res.data);
}

export function verifyEmail(body: VerifyEmailRequest) {
  return httpClient.post<SuccessMessageResponse>('/auth/verify-email', body).then((res) => res.data);
}

export function resendVerification(body?: ResendVerificationRequest) {
  return httpClient
    .post<SuccessMessageResponse>('/auth/resend-verification', body ?? {})
    .then((res) => res.data);
}

export function recoverAccount(body: RecoverAccountRequest) {
  return httpClient.post<RecoverAccountResponse>('/auth/recover-account', body).then((res) => res.data);
}

export function googleCallback(body: GoogleCallbackRequest) {
  return httpClient
    .post<GoogleCallbackResponse>('/auth/google/callback', body)
    .then((res) => res.data);
}
