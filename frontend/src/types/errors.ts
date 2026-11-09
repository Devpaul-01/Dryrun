import type { ApiErrorBody, FeatureGateError } from './api';

/**
 * Thrown by the http client's response interceptor on HTTP 402 so calling
 * code can route to the shared upgrade-prompt flow keyed by `error`,
 * instead of treating it as a generic failure (architecture doc §2.8, §4.1).
 */
export class FeatureGateException extends Error {
  readonly isFeatureGate = true as const;
  readonly body: FeatureGateError;

  constructor(body: FeatureGateError) {
    super(body.message);
    this.name = 'FeatureGateException';
    this.body = body;
  }
}

/**
 * Thrown on HTTP 429 so callers can surface `retry_after_seconds` instead
 * of a generic "try again" message (architecture doc §4.1).
 */
export class RateLimitException extends Error {
  readonly isRateLimit = true as const;
  readonly retryAfterSeconds: number | undefined;
  readonly body: ApiErrorBody;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = 'RateLimitException';
    this.retryAfterSeconds = body.retry_after_seconds;
    this.body = body;
  }
}

/**
 * Generic typed wrapper for any other non-2xx API error, so callers never
 * have to reach into raw Axios error shapes.
 */
export class ApiException extends Error {
  readonly isApiException = true as const;
  readonly status: number;
  readonly body: ApiErrorBody | undefined;

  constructor(status: number, body: ApiErrorBody | undefined) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.name = 'ApiException';
    this.status = status;
    this.body = body;
  }
}

export function isFeatureGateException(error: unknown): error is FeatureGateException {
  return error instanceof FeatureGateException;
}

export function isRateLimitException(error: unknown): error is RateLimitException {
  return error instanceof RateLimitException;
}

export function isApiException(error: unknown): error is ApiException {
  return error instanceof ApiException;
}
