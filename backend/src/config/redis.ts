import IORedis, { Redis } from 'ioredis';
import { env } from './env';
import { createLogger } from './logger';

const log = createLogger('redis');

/**
 * Single shared ioredis connection, reused by:
 *  - BullMQ queues/workers (jobs/queues.ts)
 *  - Rate limiting (middleware/rateLimit.ts)
 *  - Per-user/per-workspace AI budget counters (modules/ai/fallbackChain.ts)
 *  - Short-TTL workspace-context cache (middleware/resolveWorkspace.ts)
 *  - Narrow distributed locks (billing renewal, soft-delete purge batching)
 *
 * BullMQ requires `maxRetriesPerRequest: null` on the connection it's given —
 * documented here so a future engineer doesn't "fix" this back to a default
 * and silently break job processing under connection blips.
 */

/**
 * Two custom atomic commands, defined once here via ioredis's
 * `defineCommand` (Lua, executed atomically by Redis regardless of how
 * many app instances are calling it concurrently) rather than at each
 * call site — see config/cache.ts's file-header rationale for why shared
 * primitives live in one place instead of being re-derived per module.
 *
 * WHY THESE TWO NEEDED A LUA SCRIPT AND THE OTHER REDIS USAGE IN THIS
 * CODEBASE DIDN'T (surfaced during the horizontal-scalability review):
 * Plain `INCR`-then-compare (rateLimit.ts, demo.service.ts's abuse
 * counter) and `SET ... NX` locks (attemptRenewalCharge.worker.ts,
 * purgeSoftDeletedAccounts.worker.ts) are already atomic as single Redis
 * commands — nothing to fix there. The two genuine gaps were places doing
 * a plain GET (or nothing) followed by a *conditional* write based on
 * that separately-fetched value: two concurrent callers (whether on the
 * same instance under async interleaving, or — the case that actually
 * matters here — on two different horizontally-scaled instances) can
 * both read before either writes, and both proceed past a check that was
 * only ever true for one of them.
 *
 * checkAndReserveBudget (used by modules/ai/fallbackChain.ts):
 *   Old code: GET spent -> compare in JS -> INCRBYFLOAT if under budget.
 *   Two simultaneous AI calls for the same workspace could both read the
 *   same "spent so far" value, both see themselves as under budget, and
 *   both proceed — silently exceeding aiDailyBudgetUsdPerWorkspace by up
 *   to (concurrent-callers - 1) reservations. Fixed by moving the
 *   read+compare+increment into one Lua script: Redis executes a script
 *   as a single atomic unit, so no second caller can observe a
 *   partially-applied state.
 *   KEYS[1] = budget key, ARGV[1] = estimated cost, ARGV[2] = daily limit,
 *   ARGV[3] = TTL seconds. Returns 1 if reserved, 0 if it would exceed budget.
 *
 * claimIdempotencyKey (used by lib/idempotency.ts):
 *   Old code: GET cached-result -> if absent, run the side effect -> SET
 *   the result. Two near-simultaneous retries of the same client-supplied
 *   Idempotency-Key (exactly the scenario the mechanism exists for) could
 *   both miss the cache and both execute the side effect (e.g. both
 *   generate a playbook), which is the double-execution idempotency keys
 *   are meant to prevent. Fixed with a claim step: atomically SET-if-
 *   not-exists a short-lived "in progress" sentinel before running the
 *   side effect. A second concurrent caller sees the sentinel and knows
 *   to wait/retry rather than also executing — see lib/idempotency.ts for
 *   the full retry-with-backoff loop built on top of this primitive.
 *   KEYS[1] = idempotency key, ARGV[1] = claim TTL seconds.
 *   Returns 1 if this caller won the claim, 0 if another caller already
 *   holds it (either still running, or already has a cached result).
 */
declare module 'ioredis' {
  interface RedisCommander<Context> {
    checkAndReserveBudget(
      key: string,
      estimatedCost: string,
      dailyLimit: string,
      ttlSeconds: string
    ): Promise<number>;
    claimIdempotencyKey(key: string, claimTtlSeconds: string): Promise<number>;
  }
}

const CHECK_AND_RESERVE_BUDGET_LUA = `
local spent = tonumber(redis.call('GET', KEYS[1]) or '0')
local estimatedCost = tonumber(ARGV[1])
local dailyLimit = tonumber(ARGV[2])
local ttlSeconds = tonumber(ARGV[3])

if spent + estimatedCost > dailyLimit then
  return 0
end

redis.call('INCRBYFLOAT', KEYS[1], estimatedCost)
redis.call('EXPIRE', KEYS[1], ttlSeconds)
return 1
`;

const CLAIM_IDEMPOTENCY_KEY_LUA = `
local claimed = redis.call('SET', KEYS[1], '__CLAIMED__', 'NX', 'EX', ARGV[1])
if claimed then
  return 1
else
  return 0
end
`;

let _connection: Redis | null = null;

export function redisConnection(): Redis {
  if (!_connection) {
    _connection = new IORedis(env.redisUrl(), {
      maxRetriesPerRequest: null,
    });
    _connection.on('error', (err) => log.error({ err }, 'Redis connection error'));
    _connection.on('connect', () => log.info('Redis connected'));

    _connection.defineCommand('checkAndReserveBudget', {
      numberOfKeys: 1,
      lua: CHECK_AND_RESERVE_BUDGET_LUA,
    });
    _connection.defineCommand('claimIdempotencyKey', {
      numberOfKeys: 1,
      lua: CLAIM_IDEMPOTENCY_KEY_LUA,
    });
  }
  return _connection;
}
