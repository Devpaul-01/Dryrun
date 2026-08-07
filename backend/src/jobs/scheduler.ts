import { getQueue } from './queues';
import { createLogger } from '../config/logger';
import { supabaseAdmin } from '../config/supabase';
import { redisConnection } from '../config/redis';

const log = createLogger('scheduler');

interface ScheduleEntry {
  queue: 'maintenance' | 'ai-derivative';
  jobName: string;
  cron: string;
  data?: Record<string, unknown>;
}

const SCHEDULES: ScheduleEntry[] = [
  { queue: 'maintenance', jobName: 'purge_expired_demo_sessions', cron: '0 * * * *' }, // hourly
  { queue: 'maintenance', jobName: 'purge_soft_deleted_accounts', cron: '0 3 * * *' }, // daily 3am
  { queue: 'maintenance', jobName: 'purge_orphaned_uploads', cron: '30 * * * *' }, // hourly
  { queue: 'maintenance', jobName: 'archive_old_session_state_snapshots', cron: '0 4 * * 0' }, // weekly Sunday 4am
  { queue: 'maintenance', jobName: 'sample_ai_scoring_evaluations_for_review', cron: '0 5 * * 1' }, // weekly Monday 5am
  { queue: 'maintenance', jobName: 'dispatch_weekly_summaries', cron: '0 18 * * 0' }, // weekly Sunday 6pm
];

const REGISTRATION_LOCK_KEY = 'scheduler:registration-lock';
const REGISTRATION_LOCK_TTL_MS = 60 * 1000; // generous relative to how long registering 6 schedules actually takes

/**
 * Idempotent registration, run once on worker-process startup. Wipes and
 * re-registers repeatable jobs each boot, mirroring the pattern used
 * elsewhere in this product's job infrastructure for predictable, verified
 * schedule state rather than accumulating duplicate repeatable definitions
 * across restarts.
 *
 * DISTRIBUTED LOCK (added during the horizontal-scalability review): the
 * read-existing -> delete -> re-add sequence below is not safe if more
 * than one process runs it concurrently at boot — two worker replicas (or
 * two combined-mode replicas, now that start-all.ts exists) starting at
 * the same time could both read the same existing repeatable-job list,
 * both attempt to remove it, and both add a fresh one, risking either a
 * transient duplicate or a brief gap depending on exact timing. A simple
 * `SET NX PX` lock (the same primitive already used correctly elsewhere
 * in this codebase — see attemptRenewalCharge.worker.ts,
 * purgeSoftDeletedAccounts.worker.ts) ensures only one process actually
 * performs registration per boot cycle; every other process that starts
 * around the same time simply skips it, relying on whichever instance won
 * the lock to have left the schedules correctly registered. This is safe
 * to skip (not queue-and-wait) because registration is a one-time boot
 * action, not a per-request operation another process is blocked on.
 */
export async function registerSchedules(): Promise<void> {
  const redis = redisConnection();
  const acquired = await redis.set(REGISTRATION_LOCK_KEY, '1', 'PX', REGISTRATION_LOCK_TTL_MS, 'NX');
  if (!acquired) {
    log.info('Another process is already registering schedules — skipping (schedules are process-boot-idempotent).');
    return;
  }

  for (const entry of SCHEDULES) {
    const queue = getQueue(entry.queue);
    const existing = await queue.getRepeatableJobs();
    for (const job of existing.filter((j) => j.name === entry.jobName)) {
      await queue.removeRepeatableByKey(job.key);
    }
    await queue.add(entry.jobName, entry.data ?? {}, { repeat: { pattern: entry.cron } });
    log.info({ jobName: entry.jobName, cron: entry.cron }, 'Registered schedule');
  }
}

/**
 * `dispatch_weekly_summaries` fans out one send_weekly_summary job per
 * active user, rather than the scheduled entry itself doing per-user work —
 * keeps the scheduled job cheap and lets per-user sends retry independently.
 */
export async function dispatchWeeklySummaries(): Promise<void> {
  const { enqueue } = await import('./queues');
  const { data: members } = await supabaseAdmin().from('workspace_members').select('user_id, workspace_id').eq('status', 'active');
  for (const m of members ?? []) {
    await enqueue('notifications', 'send_weekly_summary', { userId: m.user_id, workspaceId: m.workspace_id });
  }
}
