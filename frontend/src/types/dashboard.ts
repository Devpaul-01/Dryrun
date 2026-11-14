/**
 * Wire shapes for GET /onboarding/status and GET /dashboard, verified
 * against backend practice/onboarding.routes.ts and dashboard.routes.ts.
 * Where they differ from docs/FRONTEND_ARCHITECTURE.md the backend wins
 * (differences are called out inline).
 */

import type { CurriculumPlan, ScenarioType, SkillTrendPoint } from './api';

export interface OnboardingStatusResponse {
  onboarding_completed: boolean;
}

export interface DashboardLastSession {
  id: string;
  title: string | null;
  scenario_type: ScenarioType;
  /** The backend only ever returns the most recent *completed* session here, never an active one. */
  status: 'completed';
  completed_at: string | null;
}

/** Owner/admin only (null for members). Note camelCase, unlike the rest of the API. */
export interface TeamProgressSummary {
  teamAverage: number | null;
  memberCount: number;
}

export interface DashboardResponse {
  last_session: DashboardLastSession | null;
  /**
   * The user's single most recent trend snapshot — NOT the 12-point series
   * the architecture doc implies. The sparkline's series comes from
   * GET /skill-trend instead (see useSkillTrend).
   */
  skill_trend: SkillTrendPoint | null;
  suggested_curriculum: CurriculumPlan | null;
  team_progress: TeamProgressSummary | null;
}

export interface SkillTrendResponse {
  /** Newest first, at most 12. Reverse before charting chronologically. */
  trend: SkillTrendPoint[];
}
