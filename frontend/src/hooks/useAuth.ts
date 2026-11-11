import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as authApi from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type {
  ForgotPasswordRequest,
  GoogleCallbackRequest,
  LoginRequest,
  RecoverAccountRequest,
  ResetPasswordRequest,
  SignupRequest,
  VerifyEmailRequest,
} from '@/types/requests';

/** Query key for the current user — not workspace-scoped (§4.2 keys workspace-scoped data by workspaceId; the user themselves isn't one). */
export const ME_QUERY_KEY = ['me'] as const;

/**
 * GET /auth/me. Disabled by default — the auth-gate controls exactly when
 * this should run (only once tokens exist), rather than every mount
 * firing it regardless of auth state.
 */
export function useMe(options?: { enabled?: boolean }) {
  const hasTokens = useAuthStore((state) => state.tokens !== null);

  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => authApi.getMe().then((res) => res.user),
    enabled: (options?.enabled ?? true) && hasTokens,
    staleTime: 60_000,
  });
}

export function useSignup() {
  return useMutation({
    mutationFn: (body: SignupRequest) => authApi.signup(body),
  });
}

/**
 * On success, persists tokens and seeds the user's default workspace from
 * the subsequent GET /auth/me the auth-gate triggers — login itself
 * returns no `user` (see src/types/auth.ts), so there's nothing to seed
 * the workspace store from here directly.
 */
export function useLogin() {
  const setTokens = useAuthStore((state) => state.setTokens);

  return useMutation({
    mutationFn: (body: LoginRequest) => authApi.login(body),
    onSuccess: async (session) => {
      await setTokens({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: session.expires_at,
      });
    },
  });
}

export function useLogout() {
  const clearTokens = useAuthStore((state) => state.clearTokens);
  const clearWorkspace = useWorkspaceStore((state) => state.clear);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (pushToken?: string) => authApi.logout(pushToken ? { pushToken } : undefined),
    onSettled: async () => {
      // Clear local state even if the network call failed — a user who
      // tapped "log out" should end up logged out locally regardless of
      // connectivity; the server-side session simply outlives them until
      // its own expiry in that edge case.
      await clearTokens();
      await clearWorkspace();
      queryClient.clear();
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (body: ForgotPasswordRequest) => authApi.forgotPassword(body),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (body: ResetPasswordRequest) => authApi.resetPassword(body),
  });
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: (body: VerifyEmailRequest) => authApi.verifyEmail(body),
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: () => authApi.resendVerification(),
  });
}

export function useRecoverAccount() {
  const setTokens = useAuthStore((state) => state.setTokens);

  return useMutation({
    mutationFn: (body: RecoverAccountRequest) => authApi.recoverAccount(body),
    onSuccess: async (session) => {
      await setTokens({
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: session.expires_at,
      });
    },
  });
}

/**
 * Finalizes a Google sign-in after expo-auth-session already obtained a
 * Supabase session directly from Supabase's own OAuth endpoint — this
 * call never returns tokens (see src/types/auth.ts); it just lets the
 * backend run its one-time profile/workspace provisioning. The caller is
 * expected to persist the Supabase-issued tokens itself, independent of
 * this mutation's result.
 */
export function useGoogleCallback() {
  return useMutation({
    mutationFn: (body: GoogleCallbackRequest) => authApi.googleCallback(body),
  });
}
