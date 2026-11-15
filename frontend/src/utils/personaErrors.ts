import { isApiException, isFeatureGateException, isRateLimitException } from '@/types/errors';

/** One human message for any failure from persona create / upload calls. */
export function personaErrorMessage(error: unknown): string {
  if (isFeatureGateException(error)) {
    return error.body.error === 'PERSONA_FROM_DOCUMENT_NOT_INCLUDED'
      ? 'Building buyers from text, websites or documents is not included in your current plan. You can still describe one manually.'
      : error.body.message;
  }
  if (isRateLimitException(error)) {
    return error.retryAfterSeconds
      ? `Too many requests — try again in ${error.retryAfterSeconds}s.`
      : 'Too many requests — try again shortly.';
  }
  if (isApiException(error)) return error.body?.message ?? 'Something went wrong. Please try again.';
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
