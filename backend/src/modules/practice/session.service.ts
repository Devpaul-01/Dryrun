import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { createLogger } from '../../config/logger';
import { trackEvent } from '../analytics/analytics.service';
import { generateBuyerReply, generatePersona } from '../ai/ai.service';
import { runScoringConsistencyCheck } from '../ai/scoringConsistency';
import { enqueue } from '../../jobs/queues';
import { MAX_STACKED_PRESSURE_MODIFIERS } from './scenario.config';

const log = createLogger('session-service');

const HISTORY_WINDOW_SIZE = 20; // bounded recent-window, not full unbounded transcript
const NATURAL_ENDING_EXTRA_EXCHANGES = 3;
const SUMMARIZE_EVERY_N_MESSAGES = 30; // triggers the background conversation-summarization job

interface CreateSessionInput {
  userId: string;
  workspaceId: string;
  scenarioType: string;
  pressureModifiers: string[];
  difficultyOverride?: string;
  personaId?: string;
  goal?: { goalType: string; customText?: string };
}

async function getDifficultyForUser(userId: string): Promise<string> {
  const { data } = await supabaseAdmin()
    .from('practice_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'completed');
  const total = data?.length ?? 0;
  if (total < 5) return 'beginner';
  if (total < 15) return 'standard';
  if (total < 30) return 'advanced';
  return 'expert';
}

async function getPracticeProfile(userId: string, workspaceId: string) {
  const { data } = await supabaseAdmin()
    .from('practice_profiles')
    .select('product_description, target_audience, tone_preference')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!data) {
    throw ApiError.badRequest('Complete Instant Setup (product/audience) before starting a session.');
  }
  return data;
}

export async function createSession(input: CreateSessionInput) {
  if (input.pressureModifiers.length > MAX_STACKED_PRESSURE_MODIFIERS) {
    throw ApiError.badRequest(`At most ${MAX_STACKED_PRESSURE_MODIFIERS} pressure modifiers may be stacked.`);
  }

  const difficulty = input.difficultyOverride ?? (await getDifficultyForUser(input.userId));

  const { data: session, error: sessionError } = await supabaseAdmin()
    .from('practice_sessions')
    .insert({
      user_id: input.userId,
      workspace_id: input.workspaceId,
      scenario_type: input.scenarioType,
      pressure_modifiers: input.pressureModifiers,
      difficulty_level: difficulty,
      status: 'pending',
      title: null,
    })
    .select('id')
    .single();
  if (sessionError || !session) throw ApiError.internal('Failed to create session.');

  let personaSnapshot: Record<string, unknown>;
  let personaId: string;

  if (input.personaId) {
    const { data: persona, error: personaError } = await supabaseAdmin()
      .from('personas')
      .select('*')
      .eq('id', input.personaId)
      .eq('workspace_id', input.workspaceId)
      .single();
    if (personaError || !persona) throw ApiError.notFound('Persona not found.');
    personaId = persona.id;
    personaSnapshot = persona;
  } else {
    const practiceProfile = await getPracticeProfile(input.userId, input.workspaceId);
    const generated = await generatePersona({
      workspaceId: input.workspaceId,
      practiceProfile: {
        productDescription: practiceProfile.product_description,
        targetAudience: practiceProfile.target_audience,
      },
      scenarioType: input.scenarioType,
    });

    const { data: persona, error: personaError } = await supabaseAdmin()
      .from('personas')
      .insert({
        workspace_id: input.workspaceId,
        created_by_user_id: input.userId,
        name: generated.name,
        role: generated.role,
        company_context: generated.company_context,
        main_pain: generated.main_pain,
        skepticism_about: generated.skepticism_about,
        communication_style: generated.communication_style,
        hidden_motivations: generated.hidden_motivations,
        source_type: 'generated',
        reusable: true,
      })
      .select('*')
      .single();
    if (personaError || !persona) throw ApiError.internal('Failed to create persona.');
    personaId = persona.id;
    personaSnapshot = { ...persona, interest_score: generated.interest_score, trust_score: generated.trust_score };
  }

  const title = `${input.scenarioType.replace(/_/g, ' ')} — ${(personaSnapshot as any).name ?? 'Practice'}`;

  await supabaseAdmin()
    .from('practice_sessions')
    .update({
      persona_id: personaId,
      persona_snapshot: personaSnapshot,
      status: 'active',
      title,
      started_at: new Date().toISOString(),
    })
    .eq('id', session.id);

  await supabaseAdmin().from('session_state_snapshots').insert({
    session_id: session.id,
    interest: (personaSnapshot as any).interest_score ?? 30,
    trust: (personaSnapshot as any).trust_score ?? 15,
    confusion: 0,
    buying_intent: 0,
    objection_likelihood: 0,
    momentum: 0,
    prompt_version: 'baseline',
    sequence_index: 0,
  });

  if (input.goal) {
    await supabaseAdmin().from('session_goals').insert({
      session_id: session.id,
      goal_type: input.goal.goalType,
      custom_text: input.goal.customText ?? null,
    });
    await trackEvent('session_goal_set', { userId: input.userId, workspaceId: input.workspaceId, sessionId: session.id }, {
      goalType: input.goal.goalType,
    });
  }

  await trackEvent('session_started', { userId: input.userId, workspaceId: input.workspaceId, sessionId: session.id }, {
    scenarioType: input.scenarioType,
    difficulty,
  });

  return getSessionById(session.id, input.workspaceId);
}

export async function getSessionById(sessionId: string, workspaceId: string) {
  const { data, error } = await supabaseAdmin()
    .from('practice_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('workspace_id', workspaceId)
    .single();
  if (error || !data) throw ApiError.notFound('Session not found.');
  return data;
}

export async function renameSession(sessionId: string, workspaceId: string, title: string) {
  const { data, error } = await supabaseAdmin()
    .from('practice_sessions')
    .update({ title })
    .eq('id', sessionId)
    .eq('workspace_id', workspaceId)
    .select('id, title')
    .single();
  if (error || !data) throw ApiError.notFound('Session not found.');
  return data;
}

export async function setArchived(sessionId: string, workspaceId: string, archived: boolean) {
  await supabaseAdmin()
    .from('practice_sessions')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', sessionId)
    .eq('workspace_id', workspaceId);
}

export async function deleteSession(sessionId: string, workspaceId: string, userId: string) {
  const session = await getSessionById(sessionId, workspaceId);
  if (session.user_id !== userId) throw ApiError.forbidden();
  if (!['pending', 'active'].includes(session.status)) {
    throw ApiError.conflict('Completed sessions cannot be deleted — they are used for skill tracking.');
  }
  await supabaseAdmin().from('practice_sessions').delete().eq('id', sessionId);
}

/**
 * The live-turn message flow. Never queued — must return synchronously
 * within the request cycle the user is waiting on (architecture doc §8.2).
 */
export async function sendMessage(input: {
  sessionId: string;
  workspaceId: string;
  userId: string;
  content: string;
  attachmentUploadIds: string[];
}) {
  const session = await getSessionById(input.sessionId, input.workspaceId);
  if (session.status !== 'active') {
    throw ApiError.conflict('This session has already ended.');
  }

  const { data: goalRow } = await supabaseAdmin()
    .from('session_goals')
    .select('goal_type, custom_text')
    .eq('session_id', input.sessionId)
    .maybeSingle();

  const { data: userMsg, error: userMsgError } = await supabaseAdmin()
    .from('session_messages')
    .insert({
      session_id: input.sessionId,
      role: 'user',
      content: input.content,
      sequence_index: await nextSequenceIndex(input.sessionId),
    })
    .select('id')
    .single();
  if (userMsgError || !userMsg) throw ApiError.internal('Failed to record message.');

  if (input.attachmentUploadIds.length > 0) {
    await supabaseAdmin()
      .from('session_message_attachments')
      .insert(input.attachmentUploadIds.map((uploadId) => ({ message_id: userMsg.id, upload_id: uploadId })));
  }

  const { data: history } = await supabaseAdmin()
    .from('session_messages')
    .select('role, content')
    .eq('session_id', input.sessionId)
    .in('role', ['user', 'buyer'])
    .order('sequence_index', { ascending: false })
    .limit(HISTORY_WINDOW_SIZE);

  const boundedHistory = (history ?? [])
    .reverse()
    .map((m) => ({ role: m.role as 'user' | 'buyer', content: m.content }));

  // Context replacement: for a long session, the bounded window above only
  // covers the most recent turns. If a background summary exists covering
  // the older turns that just aged out of that window, prepend it as
  // compact synthetic context — see jobs/workers/summarizeConversation.worker.ts
  // for why this exists and what it deliberately does NOT do (it never
  // edits or removes the raw session_messages record).
  const { data: summaryRow } = await supabaseAdmin()
    .from('session_context_summaries')
    .select('summary_text')
    .eq('session_id', input.sessionId)
    .maybeSingle();

  const boundedHistoryWithSummary = summaryRow
    ? [{ role: 'user' as const, content: `[Earlier in this conversation: ${summaryRow.summary_text}]` }, ...boundedHistory]
    : boundedHistory;

  const { data: latestSnapshot } = await supabaseAdmin()
    .from('session_state_snapshots')
    .select('*')
    .eq('session_id', input.sessionId)
    .order('sequence_index', { ascending: false })
    .limit(1)
    .single();

  const { response, evaluationId } = await generateBuyerReply({
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    messageId: userMsg.id,
    personaSnapshot: session.persona_snapshot,
    scenarioType: session.scenario_type,
    pressureModifiers: session.pressure_modifiers ?? [],
    difficultyLevel: session.difficulty_level,
    sessionGoal: goalRow ? { goalType: goalRow.goal_type, customText: goalRow.custom_text ?? undefined } : null,
    boundedHistory: boundedHistoryWithSummary,
    newUserMessage: input.content,
  });

  // Momentum is computed server-side — never AI-generated — as a rolling
  // average of accepted interest_delta over the last 3 turns.
  const { data: recentSnapshots } = await supabaseAdmin()
    .from('session_state_snapshots')
    .select('interest')
    .eq('session_id', input.sessionId)
    .order('sequence_index', { ascending: false })
    .limit(3);

  const newInterest = clamp((latestSnapshot?.interest ?? 30) + response.state_delta.interest_delta, 0, 100);
  const newTrust = clamp((latestSnapshot?.trust ?? 15) + response.state_delta.trust_delta, 0, 100);
  const newConfusion = clamp((latestSnapshot?.confusion ?? 0) + response.state_delta.confusion_delta, 0, 100);
  const interestHistory = [...(recentSnapshots ?? []).map((s) => s.interest).reverse(), newInterest];
  const momentum = computeMomentum(interestHistory);

  const buyerSeq = await nextSequenceIndex(input.sessionId);
  const { data: buyerMsg } = await supabaseAdmin()
    .from('session_messages')
    .insert({
      session_id: input.sessionId,
      role: 'buyer',
      content: response.reply,
      internal_monologue: response.internal_monologue,
      monologue_severity: response.monologue_severity,
      sequence_index: buyerSeq,
    })
    .select('id')
    .single();

  await supabaseAdmin().from('session_state_snapshots').insert({
    session_id: input.sessionId,
    message_id: buyerMsg?.id,
    interest: newInterest,
    trust: newTrust,
    confusion: newConfusion,
    buying_intent: response.buying_intent_score,
    objection_likelihood: response.objection_likelihood_score,
    momentum,
    prompt_version: 'v1.0.0-live-turn',
    sequence_index: buyerSeq,
  });

  await supabaseAdmin()
    .from('ai_scoring_evaluations')
    .update({ accepted_delta: response.state_delta })
    .eq('id', evaluationId);

  if (response.goal_progress != null && goalRow) {
    await supabaseAdmin()
      .from('session_goals')
      .update({ goal_progress: response.goal_progress })
      .eq('session_id', input.sessionId);
  }

  await trackEvent('session_message_sent', { userId: input.userId, workspaceId: input.workspaceId, sessionId: input.sessionId }, {});
  await trackEvent('session_state_updated', { userId: input.userId, workspaceId: input.workspaceId, sessionId: input.sessionId }, {
    interest: newInterest,
    trust: newTrust,
    momentum,
  });

  // Fire-and-forget, non-blocking consistency check.
  await enqueue('ai-derivative', 'run_async_scoring_consistency_check', { evaluationId });

  // Trigger conversation summarization once the session crosses a new
  // multiple of SUMMARIZE_EVERY_N_MESSAGES since the last summary — keeps
  // long sessions' AI context coherent without resending the full
  // transcript every turn. Never blocks the response.
  const totalMessages = buyerSeq + 1;
  if (totalMessages % SUMMARIZE_EVERY_N_MESSAGES === 0) {
    const upToSequenceIndex = Math.max(0, buyerSeq - HISTORY_WINDOW_SIZE);
    await enqueue('ai-derivative', 'summarize_conversation', {
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      upToSequenceIndex,
    });
  }

  return {
    message_ids: [userMsg.id, buyerMsg?.id].filter(Boolean),
    reply: response.reply,
    live_state: {
      interest: newInterest,
      trust: newTrust,
      confusion: newConfusion,
      buying_intent: response.buying_intent_score,
      objection_likelihood: response.objection_likelihood_score,
      momentum,
    },
    natural_ending: response.natural_ending ?? null,
  };
}

/** User accepts continuing past a signaled natural ending — never auto-ended silently. */
export async function continueSession(sessionId: string, workspaceId: string, userId: string) {
  await getSessionById(sessionId, workspaceId);
  await trackEvent('session_continued_past_ending', { userId, workspaceId, sessionId }, {});
  return { extra_exchanges_allowed: NATURAL_ENDING_EXTRA_EXCHANGES };
}

export async function endSession(sessionId: string, workspaceId: string, userId: string) {
  const session = await getSessionById(sessionId, workspaceId);
  if (session.status === 'completed') {
    return { already_completed: true };
  }

  await supabaseAdmin()
    .from('practice_sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', sessionId);

  await enqueue('ai-derivative', 'generate_debrief', { sessionId, workspaceId });
  await enqueue('ai-derivative', 'score_session_skills', { sessionId, workspaceId });

  await trackEvent('session_completed', { userId, workspaceId, sessionId }, {});
  return { already_completed: false };
}

export async function retrySession(sessionId: string, workspaceId: string, userId: string) {
  const original = await getSessionById(sessionId, workspaceId);
  if (original.status !== 'completed') throw ApiError.badRequest('Original session must be completed first.');

  const retry = await createSession({
    userId,
    workspaceId,
    scenarioType: original.scenario_type,
    pressureModifiers: original.pressure_modifiers ?? [],
  });

  await supabaseAdmin().from('practice_sessions').update({ retry_of_session_id: sessionId }).eq('id', retry.id);
  await trackEvent('retry_started', { userId, workspaceId, sessionId: retry.id }, { originalSessionId: sessionId });
  return retry;
}

async function nextSequenceIndex(sessionId: string): Promise<number> {
  const { count } = await supabaseAdmin()
    .from('session_messages')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  return count ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeMomentum(interestValues: number[]): number {
  if (interestValues.length < 2) return 0;
  const deltas: number[] = [];
  for (let i = 1; i < interestValues.length; i++) {
    deltas.push(interestValues[i] - interestValues[i - 1]);
  }
  return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}
