import { Job } from 'bullmq';
import { runScoringConsistencyCheck } from '../../modules/ai/scoringConsistency';

export async function scoringConsistencyCheckHandler(job: Job<{ evaluationId: string }>): Promise<void> {
  if (!job.data.evaluationId) return;
  await runScoringConsistencyCheck(job.data.evaluationId);
}
