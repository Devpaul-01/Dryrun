import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { createLogger } from '../../config/logger';

const log = createLogger('sample-ai-scoring-worker');
const SAMPLE_SIZE = 25;

/**
 * Produces the sampled human-review queue for GET /admin/ai-scoring/sample.
 * This job only produces the queue — it does not replace an actual person
 * reviewing it. Operational note stated explicitly in the architecture doc
 * (§10.5, step 7): this has no value if nobody looks at the sample.
 */
export async function sampleAiScoringEvaluationsHandler(_job: Job): Promise<void> {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { data: candidates } = await supabaseAdmin()
    .from('ai_scoring_evaluations')
    .select('id')
    .gte('created_at', weekAgo.toISOString())
    .eq('sampled_for_human_review', false);

  if (!candidates || candidates.length === 0) return;

  const shuffled = candidates.sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE);
  const ids = shuffled.map((c) => c.id);

  await supabaseAdmin().from('ai_scoring_evaluations').update({ sampled_for_human_review: true }).in('id', ids);
  log.info({ count: ids.length }, 'Sampled AI scoring evaluations for human review');
}
