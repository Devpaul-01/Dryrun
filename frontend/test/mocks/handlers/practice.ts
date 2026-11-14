import { HttpResponse, http } from 'msw';

import { env } from '@/config/env';
import type { DashboardResponse, OnboardingStatusResponse } from '@/types/dashboard';

const API = env.apiRoot;

export const mockOnboardingStatus: OnboardingStatusResponse = { onboarding_completed: true };

/** Shapes verified against backend dashboard.routes.ts (a real first-run response). */
export const mockEmptyDashboard: DashboardResponse = {
  last_session: null,
  skill_trend: null,
  suggested_curriculum: null,
  team_progress: null,
};

export const practiceHandlers = [
  http.get(`${API}/onboarding/status`, () => HttpResponse.json(mockOnboardingStatus)),
  http.post(`${API}/onboarding/instant-setup`, () => HttpResponse.json({ success: true })),
  http.get(`${API}/dashboard`, () => HttpResponse.json(mockEmptyDashboard)),
  http.get(`${API}/skill-trend`, () => HttpResponse.json({ trend: [] })),
];
