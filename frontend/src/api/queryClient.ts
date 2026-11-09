import { QueryClient } from '@tanstack/react-query';

import { isApiException, isRateLimitException } from '@/types/errors';

/**
 * Shared QueryClient (architecture doc §4.2). Defaults tuned for a mobile
 * client hitting a backend with real AI-call latency: don't retry 4xx
 * (client errors are never transient), do retry network/5xx a couple of
 * times with backoff.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (isApiException(error) && error.status >= 400 && error.status < 500) {
          return false;
        }
        if (isRateLimitException(error)) {
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
