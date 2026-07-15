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
 * Idempotent registration, run once on worker-process startup. Wipes and
 * re-registers repeatable jobs each boot, mirroring the pattern used
 * elsewhere in this product's job infrastructure for predictable, verified
 * schedule state rather than accumulating duplicate repeatable definitions
 * across restarts.
 */
export async function registerSchedules(): Promise<void> {
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
