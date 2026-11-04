import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { createLogger } from '../../config/logger';

const log = createLogger('curriculum-service');
const AXES = ['clarity', 'value', 'discovery', 'objection_handling', 'brevity', 'cta_strength'] as const;
const STALE_PRACTICE_DAYS = 21;

export async function recomputeCurriculum(userId: string, workspaceId: string): Promise<void> {
  const { data: recentScores } = await supabaseAdmin()
    .from('session_skill_scores')
    .select('clarity, value, discovery, objection_handling, brevity, cta_strength, session_id, practice_sessions!inner(user_id, workspace_id, scenario_type, completed_at)')
    .eq('practice_sessions.user_id', userId)
    .eq('practice_sessions.workspace_id', workspaceId)
    .order('practice_sessions(completed_at)', { ascending: false })
    .limit(10);

  if (!recentScores || recentScores.length === 0) return;

  const averages: Record<string, number> = {};
  for (const axis of AXES) {
    averages[axis] = recentScores.reduce((s, r) => s + (r as any)[axis], 0) / recentScores.length;
  }
  const weakest = Object.entries(averages).sort((a, b) => a[1] - b[1])[0][0];

  // Spaced-repetition resurfacing: a scenario type not practiced in 3+ weeks.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_PRACTICE_DAYS);
  const practicedTypes = new Set(recentScores.map((r) => (r as any).practice_sessions.scenario_type));
  const staleCandidate = ['cold_open', 'skeptic', 'price_pushback', 'bad_timing'].find(
    (t) => !practicedTypes.has(t)
  );

  // FIX (backend-takeover audit, Task #15): this used to be a bare insert
  // with no supersession of the user's prior plan(s) — every recompute
  // (triggered after each completed session) left its previous
  // status: 'active' row behind forever, with nothing (no scheduled job,
  // no expires_at check anywhere) ever transitioning it. Reproduced
  // directly against Postgres: 5 recomputes for one user produced 5
  // permanently 'active' rows. Harmless today only because both real
  // read sites (getCurrentCurriculum below, and
  // sendWeeklySummary.worker.ts) happen to order by created_at DESC
  // .limit(1) — but that's incidental, not structural, and it's exactly
  // the kind of landmine a future mobile-client endpoint (e.g. "show all
  // my curriculum history") could trip over by reasonably assuming
  // status: 'active' means currently active. Now explicitly supersedes
  // any prior active plan for this user+workspace before inserting the
  // new one, so status: 'active' stays a true singleton per user per
  // workspace and the table stops growing unbounded over a user's
  // lifetime of practice.
  await supabaseAdmin()
    .from('curriculum_plans')
    .update({ status: 'superseded' })
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');

  await supabaseAdmin().from('curriculum_plans').insert({
    user_id: userId,
    workspace_id: workspaceId,
    weakness_identified: weakest,
    sessions: [
      { session_number: 1, focus_axis: weakest, type: 'drill' },
      { session_number: 2, focus_axis: weakest, type: 'full_scenario' },
      ...(staleCandidate ? [{ session_number: 3, scenario_type: staleCandidate, type: 'spaced_repetition' }] : []),
    ],
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'active',
  });

  log.info({ userId, weakest, staleCandidate }, 'Curriculum recomputed');
}

export async function getCurrentCurriculum(userId: string, workspaceId: string) {
  const { data } = await supabaseAdmin()
    .from('curriculum_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * FIX (found during the backend-takeover coaching-module review): this
 * used to be a fire-and-forget update with no check of whether any row
 * actually matched. The (id, user_id) scoping was already correct — a
 * user can't dismiss another user's curriculum plan — but passing a
 * curriculum_id that doesn't exist, or belongs to someone else, silently
 * "succeeded" from the client's perspective while doing nothing. Every
 * other not-found/not-owned case in this module (debrief.service.ts,
 * playbook.service.ts) surfaces a 404; this now matches that convention.
 */
export async function dismissCurriculum(curriculumId: string, userId: string) {
  const { data, error } = await supabaseAdmin()
    .from('curriculum_plans')
    .update({ status: 'dismissed' })
    .eq('id', curriculumId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();
  if (error || !data) throw ApiError.notFound('Curriculum plan not found.');
}
