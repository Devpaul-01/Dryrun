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
