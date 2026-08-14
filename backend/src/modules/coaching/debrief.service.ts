import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { generateDebrief } from '../ai/ai.service';
import { createLogger } from '../../config/logger';
import { buildSessionTranscript } from './transcript';

const log = createLogger('debrief-service');

/**
 * Called by the generate_debrief background worker. Idempotent by design —
 * a second run for the same session simply overwrites the single debrief
 * row (upsert on session_id), so a retried job never produces duplicates.
 */
export async function runDebriefGeneration(sessionId: string, workspaceId: string): Promise<void> {
  const transcript = await buildSessionTranscript(sessionId);
  const { data: goal } = await supabaseAdmin()
    .from('session_goals')
    .select('goal_type, custom_text, goal_achieved')
    .eq('session_id', sessionId)
    .maybeSingle();

  const debrief = await generateDebrief(
    workspaceId,
    transcript,
    goal ? `${goal.goal_type}${goal.custom_text ? ` (${goal.custom_text})` : ''}` : undefined
  );

  await supabaseAdmin().from('session_debriefs').upsert(
    {
      session_id: sessionId,
      strength: debrief.strength,
      improvement: debrief.improvement,
      coachable_moment: debrief.coachable_moment,
      goal_reference: debrief.goal_reference ?? null,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'session_id' }
  );

  log.info({ sessionId }, 'Debrief generated');
}

/**
 * SECURITY FIX: matches the same gap closed in session.service.ts's
 * getSessionById — this was scoped by workspace_id alone, letting any
 * workspace member read another member's debrief (strength/improvement/
 * coachable_moment) by session ID.
 */
export async function getDebrief(sessionId: string, workspaceId: string, requestingUserId: string) {
  const { data: session } = await supabaseAdmin()
    .from('practice_sessions')
    .select('id, user_id')
    .eq('id', sessionId)
    .eq('workspace_id', workspaceId)
    .single();
  if (!session) throw ApiError.notFound('Session not found.');
  if (session.user_id !== requestingUserId) {
    throw ApiError.forbidden('You can only view debriefs for your own sessions.');
  }

  const { data } = await supabaseAdmin().from('session_debriefs').select('*').eq('session_id', sessionId).maybeSingle();
  return data ?? null;
}

export async function getReplay(sessionId: string, workspaceId: string, requestingUserId: string) {
  const { data: session } = await supabaseAdmin()
    .from('practice_sessions')
    .select('id, user_id, status')
    .eq('id', sessionId)
    .eq('workspace_id', workspaceId)
    .single();
  if (!session) throw ApiError.notFound('Session not found.');
  if (session.user_id !== requestingUserId) {
    // Structural privacy enforcement, not just a convention — restated at
    // the RLS layer too (db/migrations), but checked here explicitly since
    // this read path assembles a rich payload including the monologue.
    throw ApiError.forbidden('You can only replay your own sessions.');
  }
  if (session.status !== 'completed') throw ApiError.badRequest('Session is not completed yet.');

  const { data: messages } = await supabaseAdmin()
    .from('session_messages')
    .select('id, role, content, internal_monologue, monologue_severity, sequence_index, created_at')
    .eq('session_id', sessionId)
    .neq('role', 'system')
    .order('sequence_index', { ascending: true });

  const { data: snapshots } = await supabaseAdmin()
    .from('session_state_snapshots')
    .select('*')
    .eq('session_id', sessionId)
    .order('sequence_index', { ascending: true });

  return { messages: messages ?? [], heatmap: snapshots ?? [] };
}

export interface SessionExportPayload {
  session: {
    id: string;
    title: string | null;
    scenario_type: string;
    difficulty_level: string;
    status: string;
    started_at: string | null;
    completed_at: string | null;
  };
  persona: Record<string, unknown> | null;
  goal: { goal_type: string; custom_text: string | null; goal_achieved: boolean | null } | null;
  messages: { role: string; content: string; sequence_index: number; created_at: string }[];
  debrief: { strength: string; improvement: string; coachable_moment: string; goal_reference: string | null } | null;
  skill_scores: Record<string, number | string> | null;
  exported_at: string;
}

/**
 * Builds a complete, self-contained export of one practice session —
 * transcript, persona, goal, debrief, and skill scores — for a user to
 * download. Same authorization shape as getReplay() above (fetch scoped
 * by (id, workspace_id), then an explicit ownership check, since a
 * session export is at least as sensitive as replay data — it includes
 * the full transcript and coaching debrief, not just messages).
 *
 * Unlike jobs/workers/exportUserData.worker.ts's full-account export
 * (which queues a job and emails a signed storage URL, appropriate for a
 * "give me everything" GDPR-style request), this is synchronous and
 * returned directly in the response: a single session's data is small
 * (at most a few hundred message rows) and the user is actively waiting
 * on it from a specific session view, not requesting a bulk archive.
 */
export async function exportSessionData(
  sessionId: string,
  workspaceId: string,
  requestingUserId: string
): Promise<SessionExportPayload> {
  const { data: session } = await supabaseAdmin()
    .from('practice_sessions')
    .select('id, user_id, title, scenario_type, difficulty_level, status, started_at, completed_at, persona_snapshot')
    .eq('id', sessionId)
    .eq('workspace_id', workspaceId)
    .single();
  if (!session) throw ApiError.notFound('Session not found.');
  if (session.user_id !== requestingUserId) {
    throw ApiError.forbidden('You can only export your own sessions.');
  }

  const [{ data: messages }, { data: goal }, { data: debrief }, { data: skillScores }] = await Promise.all([
    supabaseAdmin()
      .from('session_messages')
      .select('role, content, sequence_index, created_at')
      .eq('session_id', sessionId)
      .neq('role', 'system')
      .order('sequence_index', { ascending: true }),
    supabaseAdmin()
      .from('session_goals')
      .select('goal_type, custom_text, goal_achieved')
      .eq('session_id', sessionId)
      .maybeSingle(),
    supabaseAdmin()
      .from('session_debriefs')
      .select('strength, improvement, coachable_moment, goal_reference')
      .eq('session_id', sessionId)
      .maybeSingle(),
    supabaseAdmin()
      .from('session_skill_scores')
      .select('clarity, value, discovery, objection_handling, brevity, cta_strength, composite_score, weakest_axis, strongest_axis')
      .eq('session_id', sessionId)
      .maybeSingle(),
  ]);

  return {
    session: {
      id: session.id,
      title: session.title,
      scenario_type: session.scenario_type,
      difficulty_level: session.difficulty_level,
      status: session.status,
      started_at: session.started_at,
      completed_at: session.completed_at,
    },
    persona: (session.persona_snapshot as Record<string, unknown>) ?? null,
    goal: goal ?? null,
    messages: messages ?? [],
    debrief: debrief ?? null,
    skill_scores: skillScores ?? null,
    exported_at: new Date().toISOString(),
  };
}

/**
 * Renders the same export payload as a plain-text transcript — the same
 * "Founder: ... / Prospect: ..." format used by transcript.ts's shared
 * buildSessionTranscript() (used across debrief/scoring/playbook prompt-
 * building), so a downloaded transcript reads the same way this product
 * internally represents a conversation everywhere else. This function
 * itself isn't a duplicate of that helper — it formats an already-fetched
 * SessionExportPayload.messages array, not a fresh session_messages query.
 */
export function renderSessionExportAsText(payload: SessionExportPayload): string {
  const lines: string[] = [];
  lines.push(`DryRun Practice Session Export`);
  lines.push(`Title: ${payload.session.title ?? '(untitled)'}`);
  lines.push(`Scenario: ${payload.session.scenario_type} | Difficulty: ${payload.session.difficulty_level}`);
  if (payload.session.completed_at) lines.push(`Completed: ${payload.session.completed_at}`);
  lines.push('');

  if (payload.goal) {
    lines.push(`Goal: ${payload.goal.goal_type}${payload.goal.custom_text ? ` — "${payload.goal.custom_text}"` : ''}`);
    if (payload.goal.goal_achieved != null) lines.push(`Goal achieved: ${payload.goal.goal_achieved ? 'Yes' : 'No'}`);
    lines.push('');
  }

  lines.push('--- Transcript ---');
  for (const m of payload.messages) {
    lines.push(`${m.role === 'user' ? 'Founder' : 'Prospect'}: ${m.content}`);
  }
  lines.push('');

  if (payload.skill_scores) {
    lines.push('--- Skill Scores ---');
    const s = payload.skill_scores as Record<string, number | string>;
    lines.push(`Clarity: ${s.clarity} | Value: ${s.value} | Discovery: ${s.discovery}`);
    lines.push(`Objection Handling: ${s.objection_handling} | Brevity: ${s.brevity} | CTA Strength: ${s.cta_strength}`);
    lines.push(`Composite: ${s.composite_score} | Strongest: ${s.strongest_axis} | Weakest: ${s.weakest_axis}`);
    lines.push('');
  }

  if (payload.debrief) {
    lines.push('--- Debrief ---');
    lines.push(`Strength: ${payload.debrief.strength}`);
    lines.push(`Improvement: ${payload.debrief.improvement}`);
    lines.push(`Coachable moment: ${payload.debrief.coachable_moment}`);
    lines.push('');
  }

  lines.push(`Exported: ${payload.exported_at}`);
  return lines.join('\n');
}
