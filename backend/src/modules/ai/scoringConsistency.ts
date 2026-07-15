import { supabaseAdmin } from '../../config/supabase';
import { createLogger } from '../../config/logger';

const log = createLogger('scoring-consistency');

/**
 * A cheap, fast, rule-based tone read on the founder's message — deliberately
 * NOT a second AI call, per the architecture doc's explicit reasoning
 * (§10.5): this is a monitoring signal, not a gate, and doesn't need
 * model-quality precision to be useful for drift detection over time.
 */
function cheapToneRead(message: string): 'positive' | 'neutral' | 'negative' {
  const aggressive = /\b(scam|ridiculous|waste of time|stupid|hate|terrible|awful)\b/i;
  const warm = /\b(thanks|appreciate|great|love|awesome|helpful|interesting)\b/i;
  if (aggressive.test(message)) return 'negative';
  if (warm.test(message)) return 'positive';
  return 'neutral';
}

/**
 * Runs after a live turn completes (enqueued as a background job, never in
 * the hot path). Flags — never blocks — a turn where the AI's reported
 * interest direction sharply disagrees with a cheap tone read on what the
 * founder actually said. This is the drift-detection signal referenced
 * throughout the architecture doc; it feeds `ai_scoring_flagged_for_review`
 * and the AI-monitoring dashboard, not the live conversation itself.
 */
export async function runScoringConsistencyCheck(evaluationId: string): Promise<void> {
  const { data: evaluation } = await supabaseAdmin()
    .from('ai_scoring_evaluations')
    .select('id, raw_response, accepted_delta')
    .eq('id', evaluationId)
    .single();

  if (!evaluation || !evaluation.accepted_delta) return;

  const founderMessage = (evaluation.raw_response as any)?.founder_message ?? '';
  const tone = cheapToneRead(founderMessage);
  const interestDelta = (evaluation.accepted_delta as any)?.interest_delta ?? 0;

  const disagreement =
    (tone === 'negative' && interestDelta > 8) || (tone === 'positive' && interestDelta < -8);

  if (disagreement) {
    await supabaseAdmin()
      .from('ai_scoring_evaluations')
      .update({ flagged_for_review: true })
      .eq('id', evaluationId);
    log.info({ evaluationId, tone, interestDelta }, 'Scoring consistency check flagged a turn for review');
  }
}
