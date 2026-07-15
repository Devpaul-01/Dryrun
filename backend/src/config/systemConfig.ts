import { supabaseAdmin } from './supabase';
import { env } from './env';
import { redisConnection } from './redis';

/**
 * `system_config` is a small key/value table (see db/migrations) holding
 * flags that must be changeable without a redeploy — most importantly
 * `payment_enforcement_enabled` (architecture doc §0.6 / §14.6).
 *
 * Reads are cached in Redis for a short TTL to avoid a DB round trip on
 * every single gated request; writes (via the admin endpoint) invalidate
 * the cache immediately rather than waiting for TTL expiry, since an admin
 * flipping a flag expects it to take effect right away.
 */
const CACHE_TTL_SECONDS = 30;
const cacheKey = (key: string) => `system_config:${key}`;

export async function getConfig<T = unknown>(key: string, fallback: T): Promise<T> {
  const redis = redisConnection();
  const cached = await redis.get(cacheKey(key));
  if (cached !== null) {
    try {
      return JSON.parse(cached) as T;
    } catch {
      // fall through to DB read on parse failure
    }
  }

  const { data } = await supabaseAdmin()
    .from('system_config')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  const value = (data?.value as T) ?? fallback;
  await redis.set(cacheKey(key), JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
  return value;
}

export async function setConfig(key: string, value: unknown, updatedBy: string): Promise<void> {
  await supabaseAdmin().from('system_config').upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  });
  await redisConnection().del(cacheKey(key));
}

export async function isPaymentEnforcementEnabled(): Promise<boolean> {
  return getConfig<boolean>('payment_enforcement_enabled', env.defaults.paymentEnforcementEnabled);
}
