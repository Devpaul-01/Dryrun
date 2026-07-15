import { Job } from 'bullmq';
import { recomputeSkillTrendForUser } from '../../modules/coaching/scoring.service';

export async function recomputeSkillTrendHandler(job: Job<{ userId: string; workspaceId: string }>): Promise<void> {
  await recomputeSkillTrendForUser(job.data.userId, job.data.workspaceId);
}
