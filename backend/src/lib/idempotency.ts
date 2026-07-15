import { redisConnection } from '../config/redis';

/**
 * Generic idempotency guard for client-retryable mutating actions
 * (e.g., playbook generation, upload-complete). The caller supplies an
 * `Idempotency-Key` header; if the same key is seen again within the TTL,
 * the cached result is returned instead of re-running the side effect.
 *
 * This is a lightweight, Redis-backed implementation appropriate for a
 * single-region deployment — sufficient for this product's current scale.
 */
const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24h

export async function withIdempotency<T>(
  key: string | undefined,
  scope: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!key) return fn();

  const redis = redisConnection();
  const redisKey = `idempotency:${scope}:${key}`;
  const existing = await redis.get(redisKey);
  if (existing) {
    return JSON.parse(existing) as T;
  }

  const result = await fn();
  await redis.set(redisKey, JSON.stringify(result), 'EX', DEFAULT_TTL_SECONDS);
  return result;
}
