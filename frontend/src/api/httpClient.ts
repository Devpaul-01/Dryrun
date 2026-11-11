import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import { env } from '@/config/env';
import { getAuthTokens, useAuthStore } from '@/stores/authStore';
import { getActiveWorkspaceId } from '@/stores/workspaceStore';
import type { ApiErrorBody, FeatureGateError } from '@/types/api';
import {
  AccountDeletedException,
  ApiException,
  EmailNotVerifiedException,
  FeatureGateException,
  RateLimitException,
} from '@/types/errors';

/**
 * Single Axios instance per architecture doc §4.1: base URL, auth header
 * injection, workspace header injection, 401/402/429 interception.
 */
export const httpClient = axios.create({
  baseURL: env.apiRoot,
  timeout: 30_000,
});

// ---- Request: attach Authorization + x-workspace-id ----

httpClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const tokens = getAuthTokens();
  if (tokens?.accessToken) {
    config.headers.set('Authorization', `Bearer ${tokens.accessToken}`);
  }

  const workspaceId = getActiveWorkspaceId();
  if (workspaceId) {
    config.headers.set('x-workspace-id', workspaceId);
  }

  return config;
});

// ---- Response: 401 refresh-and-replay, 402 feature gate, 429 rate limit ----

let refreshPromise: Promise<string | null> | null = null;

/**
 * Attempts a single silent token refresh. Concurrent 401s during the same
 * refresh share one in-flight promise rather than firing N parallel
 * refresh calls (architecture doc §4.1: "attempt a single silent token
 * refresh ... and replay the original request once").
 */
async function refreshAccessToken(): Promise<string | null> {
  const tokens = getAuthTokens();
  if (!tokens?.refreshToken) return null;

  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ access_token: string; refresh_token: string; expires_at: string }>(
        `${env.apiRoot}/auth/refresh`,
        { refresh_token: tokens.refreshToken },
      )
      .then(async (res) => {
        await useAuthStore.getState().setTokens({
          accessToken: res.data.access_token,
          refreshToken: res.data.refresh_token,
          expiresAt: res.data.expires_at,
        });
        return res.data.access_token;
      })
      .catch(async () => {
        await useAuthStore.getState().clearTokens();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

interface RetryableRequestConfig extends AxiosRequestConfig {
  _retried?: boolean;
}

httpClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const { response, config } = error;

    if (!response || !config) {
      // Network error / timeout — nothing to special-case, let the caller
      // (React Query's retry policy) handle it.
      return Promise.reject(error);
    }

    const retryableConfig = config as RetryableRequestConfig;

    if (response.status === 401 && !retryableConfig._retried) {
      retryableConfig._retried = true;
      const newAccessToken = await refreshAccessToken();

      if (newAccessToken) {
        retryableConfig.headers = {
          ...retryableConfig.headers,
          Authorization: `Bearer ${newAccessToken}`,
        };
        return httpClient.request(retryableConfig);
      }

      // Refresh failed — tokens are already cleared by refreshAccessToken,
      // which routes the app back to (public) via the auth-gate layout.
      return Promise.reject(new ApiException(401, response.data));
    }

    if (response.status === 403 && response.data?.error === 'EMAIL_NOT_VERIFIED') {
      return Promise.reject(new EmailNotVerifiedException(response.data));
    }

    if (response.status === 403 && response.data?.error === 'ACCOUNT_DELETED') {
      return Promise.reject(new AccountDeletedException(response.data));
    }

    if (response.status === 402) {
      return Promise.reject(new FeatureGateException(response.data as unknown as FeatureGateError));
    }

    if (response.status === 429) {
      return Promise.reject(new RateLimitException(response.data));
    }

    return Promise.reject(new ApiException(response.status, response.data));
  },
);
