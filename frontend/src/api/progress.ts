import { httpClient } from '@/api/httpClient';
import type { Badge, CurriculumPlan, GoalAchievementRate } from '@/types/api';

export function getGoalRates() {
  return httpClient
    .get<{ goal_achievement_rates: GoalAchievementRate[] }>('/skill-trend/goals')
    .then((res) => res.data.goal_achievement_rates);
}

export function getBadges() {
  return httpClient.get<{ badges: Badge[] }>('/badges').then((res) => res.data.badges);
}

/** `null` when there is no active plan. */
export function getCurrentCurriculum() {
  return httpClient.get<{ curriculum: CurriculumPlan | null }>('/curriculum/current').then((res) => res.data.curriculum);
}

export function dismissCurriculum(curriculumId: string) {
  return httpClient.post<{ success: boolean }>('/curriculum/dismiss', { curriculum_id: curriculumId }).then((res) => res.data);
}
