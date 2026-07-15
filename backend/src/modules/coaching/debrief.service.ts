import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { generateDebrief } from '../ai/ai.service';
import { createLogger } from '../../config/logger';

const log = createLogger('debrief-service');

async function buildTranscript(sessionId: string): Promise<string> {
  const { data: messages } = await supabaseAdmin()
    .from('session_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .neq('role', 'system')
    .order('sequence_index', { ascending: true });

  return (messages ?? []).map((m) => `${m.role === 'user' ? 'Founder' : 'Prospect'}: ${m.content}`).join('\n');
}

/**
 * Called by the generate_debrief background worker. Idempotent by design —
 * a second run for the same session simply overwrites the single debrief
 * row (upsert on session_id), so a retried job never produces duplicates.
 */
export async function runDebriefGeneration(sessionId: string, workspaceId: string): Promise<void> {
  const transcript = await buildTranscript(sessionId);
  const { data: goal } = await supabaseAdmin()
    .from('session_goals')
    .select('goal_type, custom_text, goal_progress')
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

export async function getDebrief(sessionId: string, workspaceId: string) {
  const { data: session } = await supabaseAdmin()
    .from('practice_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('workspace_id', workspaceId)
    .single();
  if (!session) throw ApiError.notFound('Session not found.');

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
