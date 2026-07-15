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
let _connection: Redis | null = null;

export function redisConnection(): Redis {
  if (!_connection) {
    _connection = new IORedis(env.redisUrl(), {
      maxRetriesPerRequest: null,
    });
    _connection.on('error', (err) => log.error({ err }, 'Redis connection error'));
    _connection.on('connect', () => log.info('Redis connected'));
  }
  return _connection;
}
