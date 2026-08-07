import { supabaseAdmin } from '../../config/supabase';
import { callWithFallback, checkAndReserveBudget } from './fallbackChain';
import {
  buildLiveTurnPrompt,
  buildPersonaSynthesisPrompt,
  buildDebriefPrompt,
  buildScoringPrompt,
  buildPlaybookPrompt,
  buildSessionComparisonPrompt,
  CURRENT_PROMPT_VERSION,
} from './promptBuilder';
import {
  liveTurnResponseSchema,
  personaSynthesisResponseSchema,
  debriefResponseSchema,
  scoringResponseSchema,
  playbookResponseSchema,
  sessionComparisonResponseSchema,
  parseAndValidate,
  LiveTurnResponse,
} from './outputValidator';
import { createLogger } from '../../config/logger';

const log = createLogger('ai-service');

const FALLBACK_NEUTRAL_RESPONSE: LiveTurnResponse = {
  reply: "Sorry, having trouble responding right now — try sending that again.",
  internal_monologue: 'Something went wrong on my end.',
  monologue_severity: 'neutral',
  state_delta: { interest_delta: 0, trust_delta: 0, confusion_delta: 0, reasoning: 'Validation fallback — no delta applied.' },
  buying_intent_score: 0,
  objection_likelihood_score: 0,
  goal_achieved: null,
  natural_ending: null,
};

interface GenerateBuyerReplyInput {
  workspaceId: string;
  sessionId: string;
  messageId: string;
  personaSnapshot: Record<string, unknown>;
  scenarioType: string;
  pressureModifiers: string[];
  difficultyLevel: string;
  sessionGoal?: { goalType: string; customText?: string } | null;
  boundedHistory: { role: 'user' | 'buyer'; content: string }[];
  newUserMessage: string;
}

/**
 * The live-turn call. Implements the full validation pipeline:
 * schema + range check → one bounded retry on failure → neutral fallback if
 * still invalid. Every attempt (accepted, retried, or fallen-back) is
 * logged to ai_scoring_evaluations regardless of outcome — this table is
 * the audit trail the whole scoring-integrity story depends on.
 */
export async function generateBuyerReply(
  input: GenerateBuyerReplyInput
): Promise<{ response: LiveTurnResponse; evaluationId: string }> {
  await checkAndReserveBudget(input.workspaceId);

  const { systemPrompt, messages } = buildLiveTurnPrompt({
    personaSnapshot: input.personaSnapshot,
    scenarioType: input.scenarioType,
    pressureModifiers: input.pressureModifiers,
    difficultyLevel: input.difficultyLevel,
    sessionGoal: input.sessionGoal,
    boundedHistory: input.boundedHistory,
    newUserMessage: input.newUserMessage,
  });

  let validationStatus: 'accepted' | 'rejected_retried' | 'rejected_fallback' = 'accepted';
  let response: LiveTurnResponse;
  let rawFirstAttempt: string | null = null;

  try {
    const result = await callWithFallback('live_turn', input.workspaceId, {
      systemPrompt,
      messages,
      temperature: 0.88,
      maxTokens: 700,
    });
    rawFirstAttempt = result.content;
    response = parseAndValidate(liveTurnResponseSchema, result.content);
  } catch (firstErr) {
    log.warn({ err: firstErr, sessionId: input.sessionId }, 'First live-turn attempt failed validation — retrying once');
    validationStatus = 'rejected_retried';
    try {
      const strictSystemPrompt = `${systemPrompt}\n\nSTRICT REMINDER: your previous response failed validation. interest_delta, trust_delta, and confusion_delta MUST each be numbers between -15 and 15. The "reasoning" field MUST be a non-empty string. Return ONLY the exact JSON shape specified — no other text.`;
      const retryResult = await callWithFallback('live_turn', input.workspaceId, {
        systemPrompt: strictSystemPrompt,
        messages,
        temperature: 0.6,
        maxTokens: 700,
      });
      response = parseAndValidate(liveTurnResponseSchema, retryResult.content);
      validationStatus = 'accepted'; // retry succeeded
    } catch (secondErr) {
      log.error({ err: secondErr, sessionId: input.sessionId }, 'Live-turn retry also failed validation — falling back to neutral delta');
      validationStatus = 'rejected_fallback';
      response = FALLBACK_NEUTRAL_RESPONSE;
    }
  }

  // Demo sessions use a synthetic "demo-<uuid>" session ID with no
  // corresponding practice_sessions row (architecture doc §1.2.1 of the
  // blueprint — demo state lives in demo_sessions.messages jsonb, not the
  // normalized tables, until conversion). Skip the evaluation-log FK write
  // in that case; the validation pipeline itself still runs in full.
  const isRealSession = /^[0-9a-f-]{36}$/i.test(input.sessionId);
  let evaluationId = '';
  if (isRealSession) {
    const { data: evaluation } = await supabaseAdmin()
      .from('ai_scoring_evaluations')
      .insert({
        session_id: input.sessionId,
        message_id: input.messageId,
        raw_response: { founder_message: input.newUserMessage, raw: rawFirstAttempt },
        validation_status: validationStatus,
        accepted_delta: validationStatus === 'rejected_fallback' ? null : response.state_delta,
        reasoning: response.state_delta.reasoning,
        prompt_version: CURRENT_PROMPT_VERSION,
      })
      .select('id')
      .single();
    evaluationId = evaluation?.id ?? '';
  }

  return { response, evaluationId };
}

export async function generatePersona(input: {
  workspaceId: string;
  practiceProfile: { productDescription: string; targetAudience: string };
  scenarioType: string;
  sourceText?: string;
}) {
  const { systemPrompt, messages } = buildPersonaSynthesisPrompt(input);
  const result = await callWithFallback('persona_synthesis', input.workspaceId, {
    systemPrompt,
    messages,
    temperature: 0.75,
    maxTokens: 500,
  });
  return parseAndValidate(personaSynthesisResponseSchema, result.content);
}

export async function generateDebrief(workspaceId: string, transcript: string, goal?: string) {
  const { systemPrompt, messages } = buildDebriefPrompt(transcript, goal);
  const result = await callWithFallback('debrief', workspaceId, {
    systemPrompt,
    messages,
    temperature: 0.5,
    maxTokens: 400,
  });
  return parseAndValidate(debriefResponseSchema, result.content);
}

export async function generateSkillScores(workspaceId: string, transcript: string) {
  const { systemPrompt, messages } = buildScoringPrompt(transcript);
  const result = await callWithFallback('scoring', workspaceId, {
    systemPrompt,
    messages,
    temperature: 0.3,
    maxTokens: 350,
  });
  return parseAndValidate(scoringResponseSchema, result.content);
}

export async function generatePlaybookContent(
  workspaceId: string,
  context: { personaSnapshot: Record<string, unknown>; bestTranscript: string }
) {
  const { systemPrompt, messages } = buildPlaybookPrompt(context);
  const result = await callWithFallback('playbook', workspaceId, {
    systemPrompt,
    messages,
    temperature: 0.55,
    maxTokens: 800,
  });
  return parseAndValidate(playbookResponseSchema, result.content);
}

export async function generateSessionComparisonSummary(
  workspaceId: string,
  input: Parameters<typeof buildSessionComparisonPrompt>[0]
) {
  const { systemPrompt, messages } = buildSessionComparisonPrompt(input);
  const result = await callWithFallback('session_comparison', workspaceId, {
    systemPrompt,
    messages,
    temperature: 0.6,
    maxTokens: 150,
  });
  return parseAndValidate(sessionComparisonResponseSchema, result.content);
}
