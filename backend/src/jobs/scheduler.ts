import { getQueue } from './queues';
import { createLogger } from '../config/logger';
import { supabaseAdmin } from '../config/supabase';

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

/**
 * Idempotent registration, run once on worker-process startup.
 *
 * MIGRATION NOTE (replaces the previous getRepeatableJobs/
 * removeRepeatableByKey/add sequence and its accompanying manual Redis
 * lock): that trio is BullMQ's now-deprecated repeatable-jobs API
 * (explicit `@deprecated` JSDoc in bullmq, "will be removed in v6").
 * Beyond just being deprecated, it had a real correctness gap — the
 * read-existing -> delete -> re-add sequence wasn't atomic, so two
 * processes booting at the same time (two worker replicas, or two
 * combined-mode replicas via start-all.ts) could race each other,
 * which is why a manual SET NX PX lock was added around it during the
 * horizontal-scalability review.
 *
 * `upsertJobScheduler(id, repeatOpts, template)` replaces all of that in
 * one call: BullMQ implements it as a single server-side Lua script
 * (addJobScheduler), so "does a scheduler with this ID already exist,
 * and if so update it in place; otherwise create it" happens as one
 * atomic Redis operation — the same atomicity guarantee the manual lock
 * was approximating from the client side, now provided natively by the
 * library for exactly this operation. The manual lock is removed
 * entirely here, not just relocated, since it's no longer solving a
 * problem that still exists.
 *
 * Each schedule's `jobName` is used directly as its jobSchedulerId — it
 * was already the unique key the old code filtered existing repeatable
 * jobs by, so reusing it here needs no new identifier scheme.
 */
export async function registerSchedules(): Promise<void> {
  for (const entry of SCHEDULES) {
    const queue = getQueue(entry.queue);
    await queue.upsertJobScheduler(entry.jobName, { pattern: entry.cron }, { name: entry.jobName, data: entry.data ?? {} });
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
