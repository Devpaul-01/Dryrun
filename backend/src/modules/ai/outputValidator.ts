import { z } from 'zod';

/**
 * This is the single most important reliability mechanism in the product
 * (architecture doc §10.5 / §19.7). The live-turn AI call's structured
 * output is treated as untrusted input requiring validation — not trusted
 * on receipt. A response that fails this validation is never silently
 * clamped-and-accepted; it's rejected outright and retried once with a
 * stricter prompt reminder (see ai.service.ts).
 */

const DELTA_BOUND = 15;

export const liveTurnResponseSchema = z.object({
  reply: z.string().min(1).max(2000),
  internal_monologue: z.string().min(1).max(400),
  monologue_severity: z.enum(['positive', 'neutral', 'negative']),
  state_delta: z.object({
    interest_delta: z.number().min(-DELTA_BOUND).max(DELTA_BOUND),
    trust_delta: z.number().min(-DELTA_BOUND).max(DELTA_BOUND),
    confusion_delta: z.number().min(-DELTA_BOUND).max(DELTA_BOUND),
    reasoning: z.string().min(1, 'reasoning is mandatory — an empty string is a validation failure'),
  }),
  buying_intent_score: z.number().min(0).max(100),
  objection_likelihood_score: z.number().min(0).max(100),
  goal_achieved: z
    .object({
      achieved: z.boolean(),
      reasoning: z.string().min(1, 'reasoning is mandatory whenever a goal was set — explains why this turn does or does not count as achieving it'),
    })
    .nullable()
    .optional(),
  natural_ending: z
    .object({ type: z.string(), reason: z.string() })
    .nullable()
    .optional(),
});

export type LiveTurnResponse = z.infer<typeof liveTurnResponseSchema>;

export const personaSynthesisResponseSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  company_context: z.string().default(''),
  main_pain: z.string().min(1),
  skepticism_about: z.string().min(1),
  communication_style: z.string().default('professional and direct'),
  hidden_motivations: z.array(z.string()).min(1),
  interest_score: z.number().min(0).max(100).default(30),
  trust_score: z.number().min(0).max(100).default(15),
  confusion_score: z.number().min(0).max(100).default(0),
});

export const debriefResponseSchema = z.object({
  strength: z.string().min(1),
  improvement: z.string().min(1),
  coachable_moment: z.string().min(1),
  goal_reference: z.string().nullable().optional(),
});

export const scoringResponseSchema = z.object({
  clarity: z.number().min(0).max(100),
  value: z.number().min(0).max(100),
  discovery: z.number().min(0).max(100),
  objection_handling: z.number().min(0).max(100),
  brevity: z.number().min(0).max(100),
  cta_strength: z.number().min(0).max(100),
  weakest_axis: z.string(),
  strongest_axis: z.string(),
});

export const playbookResponseSchema = z.object({
  opening_message: z.string().min(1),
  discovery_questions: z.array(z.string()).min(1),
  objection_responses: z.array(z.object({ objection: z.string(), response: z.string() })),
  closing_cta: z.string().min(1),
  key_insight: z.string().min(1),
});

/**
 * Strips markdown code fences an LLM sometimes wraps JSON in, then parses
 * and validates against the given schema. Throws on any failure — callers
 * (ai.service.ts) are responsible for the reject-and-retry behavior.
 */
export function parseAndValidate<T>(schema: z.ZodSchema<T>, rawContent: string): T {
  const cleaned = rawContent.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return schema.parse(parsed);
}
