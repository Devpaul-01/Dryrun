import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { createLogger } from '../../config/logger';

const log = createLogger('archive-snapshots-worker');
const ARCHIVE_AFTER_DAYS = 180;

/**
 * Fine-grained per-turn snapshots for OLD, COMPLETED sessions are prunable
 * once the session's aggregated session_skill_scores/session_debriefs
 * exist — the aggregates are permanent, the raw per-turn detail is not
 * (architecture doc §3.3 note / §4.5 retention table).
 */
export async function archiveOldSnapshotsHandler(_job: Job): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ARCHIVE_AFTER_DAYS);

  const { data: eligibleSessions } = await supabaseAdmin()
    .from('practice_sessions')
    .select('id, session_skill_scores(id), session_debriefs(id)')
    .eq('status', 'completed')
    .lt('completed_at', cutoff.toISOString())
    .limit(500);

  let archivedCount = 0;
  for (const session of eligibleSessions ?? []) {
    const hasAggregates = (session as any).session_skill_scores?.length > 0 && (session as any).session_debriefs?.length > 0;
    if (!hasAggregates) continue; // never prune raw detail before the aggregate exists

    const { count } = await supabaseAdmin()
      .from('session_state_snapshots')
      .delete({ count: 'exact' })
      .eq('session_id', session.id);
    archivedCount += count ?? 0;
  }

  if (archivedCount) log.info({ archivedCount }, 'Archived old session_state_snapshots rows');
}
