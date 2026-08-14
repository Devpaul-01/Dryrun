import { NextFunction, Request, Response } from 'express';
import { redisConnection } from '../config/redis';
import { ApiError } from '../lib/apiError';

/**
 * Step 3 of the global middleware stack.
 *
 * A small, dependency-free fixed-window counter backed by Redis —
 * deliberately simpler than a full sliding-window/token-bucket
 * implementation, which is unnecessary precision for this product's actual
 * abuse patterns (bursts from a single bad client, not sophisticated
 * distributed attacks at this stage).
 *
 * Tiers, per the architecture doc §19.5:
 *  - high-frequency/low-cost   (message send)          → generous
 *  - low-frequency/high-cost   (persona/playbook gen)   → tight
 *  - anonymous/abuse-prone     (demo, signup, resend)   → keyed by IP+fingerprint
 *  - webhook endpoint                                    → its own tight limit
 */
interface RateLimitOptions {
  windowSeconds: number;
  max: number;
  keyGenerator: (req: Request) => string;
  message?: string;
}

export function rateLimit(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const redis = redisConnection();
      const identity = options.keyGenerator(req);
      const windowBucket = Math.floor(Date.now() / (options.windowSeconds * 1000));
      const key = `ratelimit:${req.baseUrl}${req.path}:${identity}:${windowBucket}`;

      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, options.windowSeconds);
      }

      if (count > options.max) {
        throw ApiError.rateLimited(options.message);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

const byUserOrIp = (req: Request) => req.user?.id ?? req.ip ?? 'unknown';
const byIp = (req: Request) => req.ip ?? 'unknown';

/** High-frequency, low-cost: live message send. */
export const messageRateLimit = rateLimit({
  windowSeconds: 60,
  max: 60,
  keyGenerator: byUserOrIp,
});

/** Low-frequency, high-cost: persona-from-document, playbook generation. */
export const expensiveActionRateLimit = rateLimit({
  windowSeconds: 300,
  max: 10,
  keyGenerator: byUserOrIp,
  message: 'Too many generation requests. Please wait a few minutes and try again.',
});

/** Anonymous/abuse-prone: demo start, signup, resend-verification, forgot-password. */
export const anonymousActionRateLimit = rateLimit({
  windowSeconds: 3600,
  max: 5,
  keyGenerator: byIp,
});

/** Webhook endpoint — bounds an attacker's probing attempts even though the caller is a trusted provider. */
export const webhookRateLimit = rateLimit({
  windowSeconds: 60,
  max: 120,
  keyGenerator: byIp,
});

/** Standard per-route default for everything else not explicitly tiered above. */
export const defaultRateLimit = rateLimit({
  windowSeconds: 60,
  max: 120,
  keyGenerator: byUserOrIp,
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
export const adminActionRateLimit = rateLimit({
  windowSeconds: 300,
  max: 20,
  keyGenerator: byUserOrIp,
  message: 'Too many admin actions in a short period. Please slow down.',
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
export const uploadRateLimit = rateLimit({
  windowSeconds: 60,
  max: 20,
  keyGenerator: byUserOrIp,
  message: 'Too many upload requests. Please wait a moment and try again.',
});

/**
 * Full-account data export (GET /user/export) — enqueues a job that reads
 * a user's entire session/persona/playbook history and writes a file to
 * storage. A genuinely rare, deliberate action; same order of magnitude
 * as anonymousActionRateLimit but keyed by authenticated user rather than
 * IP, since this route requires authentication.
 */
export const exportRateLimit = rateLimit({
  windowSeconds: 3600,
  max: 3,
  keyGenerator: byUserOrIp,
  message: 'Too many export requests. Please wait before requesting another export.',
});
