import { redisConnection } from '../config/redis';

/**
 * Generic idempotency guard for client-retryable mutating actions
 * (e.g., playbook generation, upload-complete). The caller supplies an
 * `Idempotency-Key` header; if the same key is seen again within the TTL,
 * the cached result is returned instead of re-running the side effect.
 *
 * This is a lightweight, Redis-backed implementation appropriate for a
 * single-region deployment — sufficient for this product's current scale.
 *
 * CONCURRENCY FIX (surfaced during the horizontal-scalability review):
 * the original version did GET cached-result -> if absent, run `fn()` ->
 * SET the result. Two near-simultaneous retries of the same key — exactly
 * the scenario this mechanism exists to handle, e.g. a client that
 * retried after a dropped response before the first attempt had finished
 * — could both miss the cache and both execute `fn()`, defeating the
 * whole point. Fixed with a claim step (an atomic SET-if-not-exists
 * sentinel, defined in config/redis.ts): only the caller that wins the
 * claim runs `fn()`; a caller that loses the claim polls briefly for the
 * winner's result instead of also executing the side effect. This holds
 * across any number of horizontally-scaled instances since the claim is
 * a single atomic Redis operation, not process-local state.
 */
const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24h — how long a completed result stays cached
const CLAIM_TTL_SECONDS = 30; // how long a claim is held while `fn()` runs, before it's considered abandoned
const POLL_INTERVAL_MS = 200;
const MAX_POLL_ATTEMPTS = Math.ceil((CLAIM_TTL_SECONDS * 1000) / POLL_INTERVAL_MS);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withIdempotency<T>(
  key: string | undefined,
  scope: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!key) return fn();

  const redis = redisConnection();
  const redisKey = `idempotency:${scope}:${key}`;

  const existing = await redis.get(redisKey);
  if (existing && existing !== CLAIMED_SENTINEL) {
    return JSON.parse(existing) as T;
  }

  const wonClaim = existing === null && (await redis.claimIdempotencyKey(redisKey, String(CLAIM_TTL_SECONDS))) === 1;

  if (wonClaim) {
    try {
      const result = await fn();
      await redis.set(redisKey, JSON.stringify(result), 'EX', DEFAULT_TTL_SECONDS);
      return result;
    } catch (err) {
      // A failed attempt must not leave the claim sentinel sitting there
      // for the full CLAIM_TTL_SECONDS blocking a legitimate retry — clear
      // it immediately so the very next retry (this is a client-retryable
      // action, per this module's own contract) can attempt fn() again
      // rather than waiting out the claim TTL for nothing.
      await redis.del(redisKey);
      throw err;
    }
  }

  // Another caller holds the claim (or won it a moment ago) — poll for
  // its result rather than also running `fn()`. Bounded by CLAIM_TTL_SECONDS
  // (the longest a legitimate in-progress claim can hold), not indefinite.
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const value = await redis.get(redisKey);
    if (value && value !== CLAIMED_SENTINEL) {
      return JSON.parse(value) as T;
    }
    if (value === null) {
      // The claim holder cleared it (its fn() failed) or the claim
      // expired without a result ever being written — safe to try
      // claiming it ourselves now rather than waiting out the full loop.
      break;
    }
  }

  // Fell through: either the original claim holder's attempt failed and
  // cleared the key, or its claim expired without producing a result
  // (e.g. that instance crashed mid-`fn()`). Try once more to claim and
  // execute directly, rather than returning a confusing error for what
  // is, from the caller's perspective, a normal retryable request.
  const secondAttemptClaim = await redis.claimIdempotencyKey(redisKey, String(CLAIM_TTL_SECONDS));
  if (secondAttemptClaim === 1) {
    try {
      const result = await fn();
      await redis.set(redisKey, JSON.stringify(result), 'EX', DEFAULT_TTL_SECONDS);
      return result;
    } catch (err) {
      await redis.del(redisKey);
      throw err;
    }
  }

  // Extremely unlikely (another caller claimed in the tiny window between
  // our poll loop ending and this final claim attempt) — one last direct
  // read, then give up and let the caller's own retry logic handle it.
  const finalValue = await redis.get(redisKey);
  if (finalValue && finalValue !== CLAIMED_SENTINEL) {
    return JSON.parse(finalValue) as T;
  }
  return fn();
}

const CLAIMED_SENTINEL = '__CLAIMED__'; // must match claimIdempotencyKey's Lua script in config/redis.ts
