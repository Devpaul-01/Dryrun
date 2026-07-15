import { supabaseAdmin } from '../../config/supabase';
import { generateSkillScores } from '../ai/ai.service';
import { createLogger } from '../../config/logger';

const log = createLogger('scoring-service');

async function buildTranscript(sessionId: string): Promise<string> {
  const { data: messages } = await supabaseAdmin()
    .from('session_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .neq('role', 'system')
    .order('sequence_index', { ascending: true });
  return (messages ?? []).map((m) => `${m.role === 'user' ? 'Founder' : 'Prospect'}: ${m.content}`).join('\n');
}

export async function runSkillScoring(sessionId: string, workspaceId: string): Promise<void> {
  const transcript = await buildTranscript(sessionId);
  const scores = await generateSkillScores(workspaceId, transcript);

  const composite =
    (scores.clarity + scores.value + scores.discovery + scores.objection_handling + scores.brevity + scores.cta_strength) / 6;

  await supabaseAdmin().from('session_skill_scores').upsert(
    {
      session_id: sessionId,
      clarity: scores.clarity,
      value: scores.value,
      discovery: scores.discovery,
      objection_handling: scores.objection_handling,
      brevity: scores.brevity,
      cta_strength: scores.cta_strength,
      composite_score: composite,
      weakest_axis: scores.weakest_axis,
      strongest_axis: scores.strongest_axis,
    },
    { onConflict: 'session_id' }
  );

  log.info({ sessionId, composite }, 'Skill scoring generated');
}

/** Recomputes the rolling user_skill_trend snapshot — scheduled, not synchronous per session. */
export async function recomputeSkillTrendForUser(userId: string, workspaceId: string): Promise<void> {
  const { data: scores } = await supabaseAdmin()
    .from('session_skill_scores')
    .select('composite_score, session_id, practice_sessions!inner(user_id, workspace_id, completed_at)')
    .eq('practice_sessions.user_id', userId)
    .eq('practice_sessions.workspace_id', workspaceId)
    .order('practice_sessions(completed_at)', { ascending: false })
    .limit(30);

  if (!scores || scores.length === 0) return;

  const compositeAvg = scores.reduce((sum, s) => sum + s.composite_score, 0) / scores.length;
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - 30);

  await supabaseAdmin().from('user_skill_trend').insert({
    user_id: userId,
    workspace_id: workspaceId,
    composite_avg: compositeAvg,
    period_start: periodStart.toISOString(),
    period_end: new Date().toISOString(),
    sessions_count: scores.length,
  });
}
