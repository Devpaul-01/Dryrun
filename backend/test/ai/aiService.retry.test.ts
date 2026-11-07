import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBuyerReply, generatePersona } from '../../src/modules/ai/ai.service';

/**
 * Regression coverage for the reject→retry→fallback behavior in
 * ai.service.ts (AUDIT.md Pass 4). The output-validation schemas
 * themselves are covered in outputValidator.test.ts — this file instead
 * covers the control flow built on top of them: what each AI call type
 * actually does when the provider returns content that fails validation.
 *
 * Mocks callWithFallback (the network-calling layer) and supabaseAdmin
 * (the DB layer) so these tests run instantly with no real AI provider
 * or database — the thing under test is ai.service.ts's own retry logic,
 * not the providers or the database it talks to.
 */

const callWithFallbackMock = vi.fn();
vi.mock('../../src/modules/ai/fallbackChain', () => ({
  callWithFallback: (...args: unknown[]) => callWithFallbackMock(...args),
}));

const insertMock = vi.fn();
const selectMock = vi.fn();
const singleMock = vi.fn();
vi.mock('../../src/config/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (...args: unknown[]) => {
        insertMock(...args);
        return { select: selectMock };
      },
    }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  selectMock.mockReturnValue({ single: singleMock });
  singleMock.mockResolvedValue({ data: { id: 'evaluation-id-123' } });
});

function providerResult(content: string) {
  return { content, tokensIn: 10, tokensOut: 10, modelUsed: 'test-model', providerUsed: 'test-provider' };
}

const VALID_LIVE_TURN_JSON = JSON.stringify({
  reply: 'Tell me more.',
  internal_monologue: 'Interesting.',
  monologue_severity: 'neutral',
  state_delta: { interest_delta: 2, trust_delta: 0, confusion_delta: 0, reasoning: 'Mild positive signal.' },
  buying_intent_score: 50,
  objection_likelihood_score: 30,
  goal_achieved: null,
  natural_ending: null,
});

const INVALID_LIVE_TURN_JSON = JSON.stringify({ reply: 'Tell me more.' }); // missing every other required field

const baseInput = {
  workspaceId: 'ws-1',
  sessionId: 'demo-not-a-real-session', // deliberately not a real session ID -- skips the evaluation-log DB write path for most tests
  messageId: 'msg-1',
  personaSnapshot: {},
  scenarioType: 'cold_call',
  pressureModifiers: [],
  difficultyLevel: 'medium',
  sessionGoal: null,
  boundedHistory: [],
  newUserMessage: 'Hi there',
};

describe('generateBuyerReply — reject/retry/fallback pipeline', () => {
  it('accepts a valid first response with no retry', async () => {
    callWithFallbackMock.mockResolvedValueOnce(providerResult(VALID_LIVE_TURN_JSON));

    const { response } = await generateBuyerReply(baseInput);

    expect(callWithFallbackMock).toHaveBeenCalledTimes(1);
    expect(response.reply).toBe('Tell me more.');
    expect(response.state_delta.interest_delta).toBe(2);
  });

  it('retries once on a validation failure and succeeds on the second attempt', async () => {
    callWithFallbackMock
      .mockResolvedValueOnce(providerResult(INVALID_LIVE_TURN_JSON))
      .mockResolvedValueOnce(providerResult(VALID_LIVE_TURN_JSON));

    const { response } = await generateBuyerReply(baseInput);

    expect(callWithFallbackMock).toHaveBeenCalledTimes(2);
    // The retry call must use a stricter system prompt reminding the
    // model of the exact validation rules -- this is what distinguishes
    // a real retry from merely calling the same thing twice.
    const secondCallOptions = callWithFallbackMock.mock.calls[1][2];
    expect(secondCallOptions.systemPrompt).toContain('STRICT REMINDER');
    expect(response.reply).toBe('Tell me more.');
  });

  it('falls back to the neutral response when both attempts fail validation — never throws to the caller', async () => {
    callWithFallbackMock
      .mockResolvedValueOnce(providerResult(INVALID_LIVE_TURN_JSON))
      .mockResolvedValueOnce(providerResult(INVALID_LIVE_TURN_JSON));

    const { response } = await generateBuyerReply(baseInput);

    expect(callWithFallbackMock).toHaveBeenCalledTimes(2);
    // Neutral fallback: zero deltas, so a failed validation can never
    // silently move the conversation state.
    expect(response.state_delta.interest_delta).toBe(0);
    expect(response.state_delta.trust_delta).toBe(0);
    expect(response.state_delta.confusion_delta).toBe(0);
  });

  it('falls back when the provider content is not valid JSON at all, not just schema-invalid JSON', async () => {
    callWithFallbackMock
      .mockResolvedValueOnce(providerResult('not json at all'))
      .mockResolvedValueOnce(providerResult('still not json'));

    const { response } = await generateBuyerReply(baseInput);

    expect(response.state_delta.reasoning).toBe('Validation fallback — no delta applied.');
  });

  it('logs every attempt to ai_scoring_evaluations for a real session ID, with validation_status reflecting what happened', async () => {
    callWithFallbackMock.mockResolvedValueOnce(providerResult(VALID_LIVE_TURN_JSON));

    await generateBuyerReply({ ...baseInput, sessionId: '11111111-1111-1111-1111-111111111111' });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const insertedRow = insertMock.mock.calls[0][0];
    expect(insertedRow.validation_status).toBe('accepted');
    expect(insertedRow.session_id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('records validation_status: rejected_fallback and a null accepted_delta when both attempts fail, for a real session', async () => {
    callWithFallbackMock
      .mockResolvedValueOnce(providerResult(INVALID_LIVE_TURN_JSON))
      .mockResolvedValueOnce(providerResult(INVALID_LIVE_TURN_JSON));

    await generateBuyerReply({ ...baseInput, sessionId: '22222222-2222-2222-2222-222222222222' });

    const insertedRow = insertMock.mock.calls[0][0];
    expect(insertedRow.validation_status).toBe('rejected_fallback');
    expect(insertedRow.accepted_delta).toBeNull();
  });

  it('skips the evaluation-log DB write entirely for a synthetic demo session ID', async () => {
    callWithFallbackMock.mockResolvedValueOnce(providerResult(VALID_LIVE_TURN_JSON));

    const { evaluationId } = await generateBuyerReply({ ...baseInput, sessionId: 'demo-abc123' });

    expect(insertMock).not.toHaveBeenCalled();
    expect(evaluationId).toBe('');
  });
});

describe('generatePersona — reject/retry pipeline (AUDIT.md Pass 4 fix)', () => {
  const personaInput = {
    workspaceId: 'ws-1',
    practiceProfile: { productDescription: 'A CRM for small teams', targetAudience: 'Sales managers' },
    scenarioType: 'cold_call',
  };

  const VALID_PERSONA_JSON = JSON.stringify({
    name: 'Jordan Blake',
    role: 'VP Sales',
    company_context: '',
    main_pain: 'Slow ramp time',
    skepticism_about: 'Vendor promises',
    communication_style: 'direct',
    hidden_motivations: ['wants to impress the board'],
    interest_score: 30,
    trust_score: 15,
    confusion_score: 0,
  });

  const INVALID_PERSONA_JSON = JSON.stringify({ name: 'Jordan Blake' }); // missing required fields

  it('accepts a valid first response with no retry', async () => {
    callWithFallbackMock.mockResolvedValueOnce(providerResult(VALID_PERSONA_JSON));

    const persona = await generatePersona(personaInput);

    expect(callWithFallbackMock).toHaveBeenCalledTimes(1);
    expect(persona.name).toBe('Jordan Blake');
  });

  it('retries once, with a strict reminder prompt, on a validation failure', async () => {
    callWithFallbackMock
      .mockResolvedValueOnce(providerResult(INVALID_PERSONA_JSON))
      .mockResolvedValueOnce(providerResult(VALID_PERSONA_JSON));

    const persona = await generatePersona(personaInput);

    expect(callWithFallbackMock).toHaveBeenCalledTimes(2);
    const secondCallOptions = callWithFallbackMock.mock.calls[1][2];
    expect(secondCallOptions.systemPrompt).toContain('STRICT REMINDER');
    expect(persona.name).toBe('Jordan Blake');
  });

  it('propagates the error if the retry also fails — deliberately no fallback placeholder, unlike generateBuyerReply', async () => {
    callWithFallbackMock
      .mockResolvedValueOnce(providerResult(INVALID_PERSONA_JSON))
      .mockResolvedValueOnce(providerResult(INVALID_PERSONA_JSON));

    await expect(generatePersona(personaInput)).rejects.toThrow();
    expect(callWithFallbackMock).toHaveBeenCalledTimes(2);
  });
});
