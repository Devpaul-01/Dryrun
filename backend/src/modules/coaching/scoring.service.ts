import { supabaseAdmin } from '../../config/supabase';
import { generateSkillScores, generateSessionComparisonSummary } from '../ai/ai.service';
import { createLogger } from '../../config/logger';
import { invalidate, cacheKeys } from '../../config/cache';
import { buildSessionTranscript } from './transcript';

const log = createLogger('scoring-service');

const SCORE_COLUMNS = 'clarity, value, discovery, objection_handling, brevity, cta_strength, composite_score' as const;

interface ComparisonScores {
  clarity: number;
  value: number;
  discovery: number;
  objection_handling: number;
  brevity: number;
  cta_strength: number;
  composite_score: number;
}

export interface SessionComparisonPayload {
  original_scores: ComparisonScores;
  retry_scores: ComparisonScores;
  deltas: Record<keyof ComparisonScores, number>;
  original_goal_achieved: boolean | null;
  retry_goal_achieved: boolean | null;
  summary: string;
}

export async function runSkillScoring(sessionId: string, workspaceId: string): Promise<void> {
  const transcript = await buildSessionTranscript(sessionId);
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

  await invalidate(cacheKeys.skillTrend(userId, workspaceId));
}

/**
 * Computes (and persists) the comparison between a retry session and the
 * original session it was retried from. Used two ways, per the product
 * decision to support both:
 *   1. Called automatically from scoreSessionSkills.worker.ts right after
 *      a retry session's own scoring finishes, so the comparison is
 *      usually already sitting in session_retries by the time anyone
 *      looks for it.
 *   2. Called on-demand from GET /sessions/:id/comparison as a fallback,
 *      for the case where someone checks before that background path has
 *      had time to run.
 * Both call sites share this one function rather than duplicating the
 * fetch-both-sessions-and-compute logic.
 *
 * Returns null (not an error) if either session doesn't have skill
 * scores yet — a normal, expected transient state (scoring is itself an
 * async job), not a failure. Idempotent: upserts on retry_session_id, so
 * calling this twice for the same retry is safe and just recomputes.
 */
export async function computeSessionComparison(
  retrySessionId: string,
  workspaceId: string
): Promise<SessionComparisonPayload | null> {
  const { data: retrySession } = await supabaseAdmin()
    .from('practice_sessions')
    .select('id, retry_of_session_id')
    .eq('id', retrySessionId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (!retrySession?.retry_of_session_id) return null;
  const originalSessionId = retrySession.retry_of_session_id;

  const [{ data: originalScores }, { data: retryScores }, { data: originalGoal }, { data: retryGoal }] = await Promise.all([
    supabaseAdmin().from('session_skill_scores').select(SCORE_COLUMNS).eq('session_id', originalSessionId).maybeSingle(),
    supabaseAdmin().from('session_skill_scores').select(SCORE_COLUMNS).eq('session_id', retrySessionId).maybeSingle(),
    supabaseAdmin().from('session_goals').select('goal_achieved').eq('session_id', originalSessionId).maybeSingle(),
    supabaseAdmin().from('session_goals').select('goal_achieved').eq('session_id', retrySessionId).maybeSingle(),
  ]);

  // Both sessions must be scored before a comparison means anything —
  // scoring is itself an async job, so this is a normal transient state
  // right after a retry completes, not an error condition.
  if (!originalScores || !retryScores) return null;

  const AXES: (keyof ComparisonScores)[] = ['clarity', 'value', 'discovery', 'objection_handling', 'brevity', 'cta_strength', 'composite_score'];
  const deltas = Object.fromEntries(AXES.map((axis) => [axis, retryScores[axis] - originalScores[axis]])) as Record<
    keyof ComparisonScores,
    number
  >;

  let summary: string;
  try {
    const result = await generateSessionComparisonSummary(workspaceId, {
      original: { scores: originalScores, goalAchieved: originalGoal?.goal_achieved ?? null },
      retry: { scores: retryScores, goalAchieved: retryGoal?.goal_achieved ?? null },
    });
    summary = result.summary;
  } catch (err) {
    // Best-effort for the summary sentence specifically — the numeric
    // comparison (the part that matters most, and the part this function
    // computes exactly rather than trusting the model with) is still
    // saved even if the AI summary call fails.
    log.warn({ err, retrySessionId }, 'Session comparison summary generation failed — saving numeric comparison without it');
    summary = `Composite score ${deltas.composite_score >= 0 ? 'improved' : 'changed'} by ${Math.abs(Math.round(deltas.composite_score))} points on this retry.`;
  }

  const payload: SessionComparisonPayload = {
    original_scores: originalScores,
    retry_scores: retryScores,
    deltas,
    original_goal_achieved: originalGoal?.goal_achieved ?? null,
    retry_goal_achieved: retryGoal?.goal_achieved ?? null,
    summary,
  };

  await supabaseAdmin()
    .from('session_retries')
    .upsert({ retry_session_id: retrySessionId, comparison: payload }, { onConflict: 'retry_session_id' });

  return payload;
}
