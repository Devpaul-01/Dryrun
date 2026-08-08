import { Request } from 'express';
import rateLimit, { Options as RateLimitOptions } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisConnection } from '../config/redis';
import { ApiError } from '../lib/apiError';

/**
 * Step 3 of the global middleware stack.
 *
 * Built on `express-rate-limit` with a Redis-backed store, so counters are
 * shared across horizontally-scaled instances instead of living in
 * per-process memory.
 *
 * IMPORTANT — each limiter below gets its OWN `RedisStore` instance. The
 * underlying `rate-limit-redis` store is stateful per-instance (it tracks
 * which limiter "owns" it internally), so passing the same `RedisStore`
 * object into two different `rateLimit(...)` calls throws
 * `ERR_ERL_STORE_REUSE` at runtime. `redisConnection()` itself IS shared
 * (see config/redis.ts) — it's the underlying ioredis client, which is
 * safe and intended to be reused. What must NOT be reused is the
 * `RedisStore` wrapper object. `makeStore()` below exists specifically to
 * make a fresh wrapper per limiter while still pointing at the one shared
 * connection.
 *
 * Tiers, per the architecture doc §19.5:
 *  - high-frequency/low-cost   (message send)          → generous
 *  - low-frequency/high-cost   (persona/playbook gen)   → tight
 *  - anonymous/abuse-prone     (demo, signup, resend)   → keyed by IP+fingerprint
 *  - webhook endpoint                                    → its own tight limit
 */

type KeyGenerator = (req: Request) => string;

const byUserOrIp: KeyGenerator = (req) => req.user?.id ?? req.ip ?? 'unknown';
const byIp: KeyGenerator = (req) => req.ip ?? 'unknown';

/**
 * Builds a fresh RedisStore for a single limiter. `prefix` namespaces the
 * keys per-tier so different limiters never collide in Redis even if two
 * limiters happened to see the same identity + route (defense in depth on
 * top of express-rate-limit's own internal windowing).
 *
 * NEVER hoist a single `makeStore()` result and pass it into multiple
 * `rateLimit()` calls — see file header. Always call `makeStore()` fresh
 * at each limiter's definition site.
 */
function makeStore(prefix: string): RedisStore {
  return new RedisStore({
    // ioredis's call signature is (command, ...args); rate-limit-redis
    // expects a `sendCommand` that spreads args the same way.
    sendCommand: (...args: string[]) => redisConnection().call(...args) as Promise<any>,
    prefix: `ratelimit:${prefix}:`,
  });
}

interface TierOptions {
  windowSeconds: number;
  max: number;
  keyGenerator: KeyGenerator;
  message?: string;
  storePrefix: string;
}

function buildLimiter(options: TierOptions) {
  const partialOptions: Partial<RateLimitOptions> = {
    windowMs: options.windowSeconds * 1000,
    max: options.max,
    standardHeaders: true, // RateLimit-* headers (draft-7)
    legacyHeaders: false, // no X-RateLimit-* headers
    keyGenerator: options.keyGenerator,
    store: makeStore(options.storePrefix),
    handler: (_req, _res, next) => {
      next(ApiError.rateLimited(options.message));
    },
  };
  return rateLimit(partialOptions);
}

/** High-frequency, low-cost: live message send. */
export const messageRateLimit = buildLimiter({
  windowSeconds: 60,
  max: 60,
  keyGenerator: byUserOrIp,
  storePrefix: 'message',
});

/** Low-frequency, high-cost: persona-from-document, playbook generation. */
export const expensiveActionRateLimit = buildLimiter({
  windowSeconds: 300,
  max: 10,
  keyGenerator: byUserOrIp,
  message: 'Too many generation requests. Please wait a few minutes and try again.',
  storePrefix: 'expensive-action',
});

/** Anonymous/abuse-prone: demo start, signup, resend-verification, forgot-password. */
export const anonymousActionRateLimit = buildLimiter({
  windowSeconds: 3600,
  max: 5,
  keyGenerator: byIp,
  storePrefix: 'anon-action',
});

/** Webhook endpoint — bounds an attacker's probing attempts even though the caller is a trusted provider. */
export const webhookRateLimit = buildLimiter({
  windowSeconds: 60,
  max: 120,
  keyGenerator: byIp,
  storePrefix: 'webhook',
});

/** Standard per-route default for everything else not explicitly tiered above. */
export const defaultRateLimit = buildLimiter({
  windowSeconds: 60,
  max: 120,
  keyGenerator: byUserOrIp,
  storePrefix: 'default',
});

/**
 * Admin WRITE actions specifically (job retry, system-config changes) —
 * NOT applied to admin read endpoints (/jobs, /audit-log, /ai-scoring/sample),
 * which a legitimate ops dashboard may poll more frequently than a rare,
 * deliberate write action warrants. requireAdmin (authorization) already
 * gates every admin route; this adds a rate ceiling on top so a
 * compromised admin session or a buggy internal script can't rapid-fire
 * config flips or job retries. Tighter than expensiveActionRateLimit
 * since these actions are rarer and higher-consequence than a user
 * generating a persona.
 */
export const adminActionRateLimit = buildLimiter({
  windowSeconds: 300,
  max: 20,
  keyGenerator: byUserOrIp,
  message: 'Too many admin actions in a short period. Please slow down.',
  storePrefix: 'admin-action',
});

/**
 * Upload provisioning (signed-URL issuance, upload-complete). Each call
 * triggers a real Supabase Storage API call and (on complete) an AV-scan
 * job enqueue — not free, but also a legitimate burst pattern exists
 * (attaching several files to one message means several rapid calls to
 * POST /signed-url, per upload.routes.ts's own documented one-file-at-a-
 * time design). Set well above a normal multi-file attachment burst,
 * well below what the 120/min default would otherwise allow.
 */
export const uploadRateLimit = buildLimiter({
  windowSeconds: 60,
  max: 20,
  keyGenerator: byUserOrIp,
  message: 'Too many upload requests. Please wait a moment and try again.',
  storePrefix: 'upload',
});

/**
 * Full-account data export (GET /user/export) — enqueues a job that reads
 * a user's entire session/persona/playbook history and writes a file to
 * storage. A genuinely rare, deliberate action; same order of magnitude
 * as anonymousActionRateLimit but keyed by authenticated user rather than
 * IP, since this route requires authentication.
 */
export const exportRateLimit = buildLimiter({
  windowSeconds: 3600,
  max: 3,
  keyGenerator: byUserOrIp,
  message: 'Too many export requests. Please wait before requesting another export.',
  storePrefix: 'export',
});
