import { Job } from 'bullmq';
import { recomputeCurriculum } from '../../modules/coaching/curriculum.service';

export async function recomputeCurriculumHandler(job: Job<{ userId: string; workspaceId: string }>): Promise<void> {
  await recomputeCurriculum(job.data.userId, job.data.workspaceId);
}
