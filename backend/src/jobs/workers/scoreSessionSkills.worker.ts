import { Job } from 'bullmq';
import { runSkillScoring } from '../../modules/coaching/scoring.service';
import { checkAndAwardBadges } from '../../modules/coaching/badges.service';
import { publishStatus } from '../../realtime/channels';
import { enqueue } from '../queues';
import { supabaseAdmin } from '../../config/supabase';

export async function scoreSessionSkillsHandler(job: Job<{ sessionId: string; workspaceId: string }>): Promise<void> {
  const { sessionId, workspaceId } = job.data;
  await runSkillScoring(sessionId, workspaceId);
  await publishStatus('session', sessionId, 'scoring_ready', { sessionId });

  const { data: session } = await supabaseAdmin()
    .from('practice_sessions')
    .select('user_id, scenario_type')
    .eq('id', sessionId)
    .single();

  if (session) {
    // Badges are a side effect of scoring completion, not a separate polling job.
    await checkAndAwardBadges(session.user_id, workspaceId, session.scenario_type);
    await enqueue('ai-derivative', 'recompute_skill_trend', { userId: session.user_id, workspaceId });
    await enqueue('ai-derivative', 'recompute_curriculum', { userId: session.user_id, workspaceId });
  }
}
