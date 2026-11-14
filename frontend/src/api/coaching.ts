import { httpClient } from '@/api/httpClient';
import type { SkillTrendResponse } from '@/types/dashboard';

export function getSkillTrend() {
  return httpClient.get<SkillTrendResponse>('/skill-trend').then((res) => res.data);
}
