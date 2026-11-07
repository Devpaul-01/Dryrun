import { describe, expect, it } from 'vitest';
import {
  liveTurnResponseSchema,
  personaSynthesisResponseSchema,
  debriefResponseSchema,
  scoringResponseSchema,
  playbookResponseSchema,
  sessionComparisonResponseSchema,
  parseAndValidate,
} from '../../src/modules/ai/outputValidator';

/**
 * Regression coverage for the AI output-validation pipeline
 * (AUDIT.md Pass 4). This is, per that pass's own framing, "the single
 * most important reliability mechanism in the product" — every AI call's
 * structured output is untrusted input that must pass these schemas
 * before the rest of the app treats it as real. Pass 4 reviewed the
 * schemas and found them well-scoped (range-bounded numerics, mandatory
 * non-empty reasoning fields, markdown-fence stripping) with no gaps —
 * this suite exists to keep that true as the schemas evolve, and to
 * exercise the exact three cases the retry logic in ai.service.ts
 * depends on: malformed JSON, valid-JSON-but-schema-violating content,
 * and a fully valid response.
 */
describe('parseAndValidate', () => {
  it('strips a ```json fenced code block before parsing', () => {
    const raw = '```json\n{"summary": "Great energy, kept it concise."}\n```';
    const result = parseAndValidate(sessionComparisonResponseSchema, raw);
    expect(result.summary).toBe('Great energy, kept it concise.');
  });

  it('strips a bare ``` fenced code block (no language tag) before parsing', () => {
    const raw = '```\n{"summary": "Solid close."}\n```';
    const result = parseAndValidate(sessionComparisonResponseSchema, raw);
    expect(result.summary).toBe('Solid close.');
  });

  it('throws on malformed JSON — the first of the two failure modes the retry logic depends on', () => {
    expect(() => parseAndValidate(sessionComparisonResponseSchema, '{not valid json')).toThrow();
  });

  it('throws on valid JSON that violates the schema — the second failure mode the retry logic depends on', () => {
    // Valid JSON, but `summary` is missing entirely.
    expect(() => parseAndValidate(sessionComparisonResponseSchema, '{"wrong_field": "oops"}')).toThrow();
  });

  it('succeeds on a fully valid response — the case the retry logic should never need to touch', () => {
    const result = parseAndValidate(sessionComparisonResponseSchema, '{"summary": "Nice pacing."}');
    expect(result).toEqual({ summary: 'Nice pacing.' });
  });
});

describe('liveTurnResponseSchema', () => {
  const validPayload = {
    reply: 'Tell me more about the pricing.',
    internal_monologue: 'This could work for my budget.',
    monologue_severity: 'neutral',
    state_delta: {
      interest_delta: 5,
      trust_delta: -2,
      confusion_delta: 0,
      reasoning: 'The pricing question signals genuine interest.',
    },
    buying_intent_score: 60,
    objection_likelihood_score: 20,
    goal_achieved: null,
    natural_ending: null,
  };

  it('accepts a fully valid payload', () => {
    expect(() => liveTurnResponseSchema.parse(validPayload)).not.toThrow();
  });

  it.each([-15, 15])('accepts a delta exactly at the %i bound', (bound) => {
    const payload = { ...validPayload, state_delta: { ...validPayload.state_delta, interest_delta: bound } };
    expect(() => liveTurnResponseSchema.parse(payload)).not.toThrow();
  });

  it.each([-15.01, 15.01, -16, 16, 100, -100])('rejects a delta of %f, outside the ±15 bound', (delta) => {
    const payload = { ...validPayload, state_delta: { ...validPayload.state_delta, interest_delta: delta } };
    expect(() => liveTurnResponseSchema.parse(payload)).toThrow();
  });

  it('rejects an empty reasoning string — mandatory per Pass 4\'s review', () => {
    const payload = { ...validPayload, state_delta: { ...validPayload.state_delta, reasoning: '' } };
    expect(() => liveTurnResponseSchema.parse(payload)).toThrow();
  });

  it('rejects a buying_intent_score outside 0–100', () => {
    expect(() => liveTurnResponseSchema.parse({ ...validPayload, buying_intent_score: 101 })).toThrow();
    expect(() => liveTurnResponseSchema.parse({ ...validPayload, buying_intent_score: -1 })).toThrow();
  });

  it('rejects an invalid monologue_severity enum value', () => {
    expect(() => liveTurnResponseSchema.parse({ ...validPayload, monologue_severity: 'furious' })).toThrow();
  });

  it('accepts goal_achieved and natural_ending when present with their own required fields', () => {
    const payload = {
      ...validPayload,
      goal_achieved: { achieved: true, reasoning: 'Buyer explicitly agreed to a demo.' },
      natural_ending: { type: 'closed_won', reason: 'Buyer committed to next steps.' },
    };
    expect(() => liveTurnResponseSchema.parse(payload)).not.toThrow();
  });

  it('rejects a goal_achieved object with an empty reasoning string', () => {
    const payload = { ...validPayload, goal_achieved: { achieved: false, reasoning: '' } };
    expect(() => liveTurnResponseSchema.parse(payload)).toThrow();
  });

  it('rejects a reply over the 2000-character cap', () => {
    const payload = { ...validPayload, reply: 'x'.repeat(2001) };
    expect(() => liveTurnResponseSchema.parse(payload)).toThrow();
  });
});

describe('personaSynthesisResponseSchema', () => {
  const validPayload = {
    name: 'Jordan Blake',
    role: 'VP of Sales',
    company_context: 'Mid-market SaaS, ~80 employees',
    main_pain: 'Rep ramp time is too slow.',
    skepticism_about: 'ROI claims from vendors who oversell.',
    communication_style: 'direct and skeptical',
    hidden_motivations: ['wants to look good to the board'],
    interest_score: 40,
    trust_score: 10,
    confusion_score: 5,
  };

  it('accepts a fully valid payload', () => {
    expect(() => personaSynthesisResponseSchema.parse(validPayload)).not.toThrow();
  });

  it('rejects an empty hidden_motivations array — min(1) is load-bearing for persona quality', () => {
    expect(() => personaSynthesisResponseSchema.parse({ ...validPayload, hidden_motivations: [] })).toThrow();
  });

  it('applies documented defaults when optional fields are omitted', () => {
    const { company_context, communication_style, interest_score, trust_score, confusion_score, ...minimal } =
      validPayload;
    const result = personaSynthesisResponseSchema.parse(minimal);
    expect(result.company_context).toBe('');
    expect(result.communication_style).toBe('professional and direct');
    expect(result.interest_score).toBe(30);
    expect(result.trust_score).toBe(15);
    expect(result.confusion_score).toBe(0);
  });

  it('rejects a missing required field (main_pain)', () => {
    const { main_pain, ...withoutMainPain } = validPayload;
    expect(() => personaSynthesisResponseSchema.parse(withoutMainPain)).toThrow();
  });
});

describe('debriefResponseSchema', () => {
  it('accepts a valid payload and allows goal_reference to be omitted or null', () => {
    const base = { strength: 'Good discovery questions.', improvement: 'Rushed the close.', coachable_moment: 'Pause after price objections.' };
    expect(() => debriefResponseSchema.parse(base)).not.toThrow();
    expect(() => debriefResponseSchema.parse({ ...base, goal_reference: null })).not.toThrow();
    expect(() => debriefResponseSchema.parse({ ...base, goal_reference: 'booked_demo' })).not.toThrow();
  });

  it('rejects an empty coachable_moment', () => {
    expect(() =>
      debriefResponseSchema.parse({ strength: 'x', improvement: 'y', coachable_moment: '' })
    ).toThrow();
  });
});

describe('scoringResponseSchema', () => {
  const validPayload = {
    clarity: 70,
    value: 65,
    discovery: 80,
    objection_handling: 55,
    brevity: 90,
    cta_strength: 60,
    weakest_axis: 'objection_handling',
    strongest_axis: 'brevity',
  };

  it('accepts a fully valid payload', () => {
    expect(() => scoringResponseSchema.parse(validPayload)).not.toThrow();
  });

  it('rejects any axis score outside 0–100', () => {
    expect(() => scoringResponseSchema.parse({ ...validPayload, clarity: 101 })).toThrow();
    expect(() => scoringResponseSchema.parse({ ...validPayload, brevity: -1 })).toThrow();
  });
});

describe('playbookResponseSchema', () => {
  it('accepts a valid payload with at least one discovery question', () => {
    const payload = {
      opening_message: 'Hi, thanks for taking the time today.',
      discovery_questions: ['What does your current process look like?'],
      objection_responses: [{ objection: 'Too expensive', response: 'Let\'s talk ROI.' }],
      closing_cta: 'Can we schedule a follow-up next week?',
      key_insight: 'Budget cycle ends in Q1.',
    };
    expect(() => playbookResponseSchema.parse(payload)).not.toThrow();
  });

  it('rejects an empty discovery_questions array', () => {
    const payload = {
      opening_message: 'Hi there.',
      discovery_questions: [],
      objection_responses: [],
      closing_cta: 'Let\'s talk.',
      key_insight: 'N/A',
    };
    expect(() => playbookResponseSchema.parse(payload)).toThrow();
  });
});

describe('sessionComparisonResponseSchema', () => {
  it('rejects a summary over the 500-character cap', () => {
    expect(() => sessionComparisonResponseSchema.parse({ summary: 'x'.repeat(501) })).toThrow();
  });

  it('rejects an empty summary', () => {
    expect(() => sessionComparisonResponseSchema.parse({ summary: '' })).toThrow();
  });
});
