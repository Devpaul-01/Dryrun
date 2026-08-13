import { redisConnection } from './redis';
import { createLogger } from './logger';

const log = createLogger('cache');

/**
 * Shared, reusable Redis caching layer used across the API and worker
 * tiers. This is the ONE place cache-key conventions, TTL policy, and
 * invalidation strategy live — no module should call `redisConnection()`
 * directly for read-through caching; that pattern is what this file
 * replaces (see systemConfig.ts and resolveWorkspace.ts, which predate
 * this utility and implement the same pattern by hand — left as-is since
 * they already work correctly, but any NEW cached read path should use
 * this module instead of re-deriving the pattern).
 *
 * ── Design ──────────────────────────────────────────────────────────────
 * Two invalidation strategies, chosen per call site:
 *
 * 1. Direct key deletion (`invalidate(key)`) — used when the writer knows
 *    exactly which key(s) it affected (e.g. updating persona `abc` only
 *    ever invalidates `persona:abc` and the owning workspace's persona
 *    list key).
 *
 * 2. Tag-based invalidation (`invalidateTag(tag)`) — used when a single
 *    write can affect a key whose exact identity the writer doesn't want
 *    to reconstruct (e.g. "any cached page of this workspace's session
 *    list" — there could be several cached cursor pages). Every cached
 *    key can optionally register itself under one or more tags via a
 *    Redis SET (`cache:tag:{tag}` -> set of member keys). Invalidating a
 *    tag deletes every member key in that set, then the set itself.
 *
 * Tag membership sets have a TTL slightly longer than the longest-lived
 * member they can contain, so an abandoned tag set can never accumulate
 * forever if a corresponding delete is ever missed — it's a safety net,
 * not the primary cleanup mechanism (invalidateTag is).
 *
 * ── Horizontal scaling ──────────────────────────────────────────────────
 * All state lives in Redis, not process memory, so this is correct
 * across any number of API/worker instances out of the box — no
 * in-process cache, no instance-local invalidation gap.
 */

const TAG_SET_TTL_SECONDS = 60 * 60 * 24; // 24h safety-net expiry for tag membership sets

function tagKey(tag: string): string {
  return `cache:tag:${tag}`;
}

export interface CacheOptions {
  ttlSeconds: number;
  tags?: string[];
}

/**
 * Read-through cache wrapper: returns the cached value if present, else
 * calls `fetcher`, caches the result, and returns it. `fetcher` is only
 * ever invoked on a miss.
 *
 * A `null`/`undefined` result from `fetcher` is cached too (as an explicit
 * cached-null sentinel) so a repeated lookup for a genuinely-missing
 * record doesn't hammer the database every time — this is what "avoid
 * unnecessary cache misses" means in practice for lookup-by-id patterns.
 */
export async function cached<T>(
  key: string,
  options: CacheOptions,
  fetcher: () => Promise<T>
): Promise<T> {
  const redis = redisConnection();

  try {
    const raw = await redis.get(key);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      return (parsed === NULL_SENTINEL ? (null as unknown as T) : parsed) as T;
    }
  } catch (err) {
    // A cache read failure must never fail the request — fall through to
    // the real fetch, same fail-open posture as systemConfig.ts.
    log.warn({ err, key }, 'Cache read failed, falling through to source');
  }

  const value = await fetcher();

  try {
    const toStore = value === null || value === undefined ? NULL_SENTINEL : value;
    const multi = redis.multi();
    multi.set(key, JSON.stringify(toStore), 'EX', options.ttlSeconds);
    for (const tag of options.tags ?? []) {
      multi.sadd(tagKey(tag), key);
      multi.expire(tagKey(tag), TAG_SET_TTL_SECONDS);
    }
    await multi.exec();
  } catch (err) {
    log.warn({ err, key }, 'Cache write failed — value still returned to caller');
  }

  return value;
}

const NULL_SENTINEL = '__CACHE_NULL__';

/** Deletes one or more specific keys. Safe to call with keys that don't exist. */
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await redisConnection().del(...keys);
  } catch (err) {
    log.warn({ err, keys }, 'Cache invalidation failed');
  }
}

/**
 * Deletes every key currently registered under `tag`, then the tag set
 * itself. Use this when a write can affect a variable/unknown set of
 * cached keys (e.g. every paginated list-cache page for a workspace).
 */
export async function invalidateTag(tag: string): Promise<void> {
  const redis = redisConnection();
  try {
    const members = await redis.smembers(tagKey(tag));
    if (members.length > 0) {
      await redis.del(...members);
    }
    await redis.del(tagKey(tag));
  } catch (err) {
    log.warn({ err, tag }, 'Tag-based cache invalidation failed');
  }
}

/**
 * TTL policy, centralized so every call site is consistent and a future
 * tuning pass touches one place. Named by data-change-frequency, not by
 * feature, so it's obvious which bucket a new cached read belongs in.
 */
export const CACHE_TTL = {
  /** Data that changes only via an explicit admin/billing action (plans catalog). */
  STABLE_MINUTES_30: 60 * 30,
  /** Aggregate/dashboard-style reads, cheap to recompute but hit often. */
  AGGREGATE_MINUTES_5: 60 * 5,
  /** List views that change on user action (personas, sessions, badges). */
  LIST_MINUTES_2: 60 * 2,
} as const;

/**
 * Cache key namespace conventions used across the codebase (documented
 * here so every new call site follows the same shape instead of
 * inventing its own):
 *
 *   plans:active                                  — GET /billing/plans catalog
 *   plans:by-key:{key}                             — resolveEffectivePlan() by plan key
 *   plans:by-id:{id}                                — resolveEffectivePlan() by plan id
 *   dashboard:{workspaceId}:{userId}                — GET /dashboard aggregate
 *   personas:list:{workspaceId}                     — GET /personas list
 *   sessions:list:{workspaceId}:{userId}:{cursor}   — GET /sessions cursor page (first page cached: cursor = "first")
 *   badges:{userId}                                 — GET /badges list
 *   skill-trend:{userId}:{workspaceId}              — GET /skill-trend list
 *
 * Tags used for bulk invalidation:
 *   personas:workspace:{workspaceId}                — every personas:list:{workspaceId} page
 *   sessions:workspace:{workspaceId}:{userId}        — every sessions:list page for this user+workspace
 */
export const cacheKeys = {
  plansActive: () => 'plans:active',
  planByKey: (key: string) => `plans:by-key:${key}`,
  planById: (id: string) => `plans:by-id:${id}`,
  dashboard: (workspaceId: string, userId: string) => `dashboard:${workspaceId}:${userId}`,
  personasList: (workspaceId: string) => `personas:list:${workspaceId}`,
  sessionsFirstPage: (workspaceId: string, userId: string, archived: boolean) =>
    `sessions:list:${workspaceId}:${userId}:${archived ? 'archived' : 'active'}:first`,
  badgesList: (userId: string) => `badges:${userId}`,
  skillTrend: (userId: string, workspaceId: string) => `skill-trend:${userId}:${workspaceId}`,
};

export const cacheTags = {
  personasWorkspace: (workspaceId: string) => `personas:workspace:${workspaceId}`,
  sessionsUserWorkspace: (workspaceId: string, userId: string) => `sessions:workspace:${workspaceId}:${userId}`,
  plans: () => 'plans:all',
};
