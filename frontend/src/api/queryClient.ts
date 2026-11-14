import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { ME_QUERY_KEY } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  isAccountDeletedException,
  isApiException,
  isEmailNotVerifiedException,
  isRateLimitException,
} from '@/types/errors';

/**
 * App-wide handling for the two 403s that mean "this session can't use the
 * app right now" (backend authenticate.ts), regardless of which screen
 * triggered the request:
 * - EMAIL_NOT_VERIFIED: re-read the user. The auth gate then sees
 *   email_verified_at is null and routes to check-email. (/auth/me itself
 *   is exempt server-side, so this can't loop.)
 * - ACCOUNT_DELETED: the account is in its deletion grace period, so sign
 *   out locally; the login screen explains how to recover it.
 */
function handleSessionBlockingError(error: unknown) {
  if (isEmailNotVerifiedException(error)) {
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    return;
  }
  if (isAccountDeletedException(error)) {
    void (async () => {
      await useAuthStore.getState().clearTokens();
      await useWorkspaceStore.getState().clear();
      queryClient.clear();
    })();
  }
}

/**
 * Shared QueryClient (architecture doc §4.2). Defaults tuned for a mobile
 * client hitting a backend with real AI-call latency: don't retry 4xx
 * (client errors are never transient), do retry network/5xx a couple of
 * times with backoff.
 */
export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleSessionBlockingError }),
  mutationCache: new MutationCache({ onError: handleSessionBlockingError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (isApiException(error) && error.status >= 400 && error.status < 500) {
          return false;
        }
        if (
          isRateLimitException(error) ||
          isEmailNotVerifiedException(error) ||
          isAccountDeletedException(error)
        ) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
