import { useQuery } from '@tanstack/react-query';

import * as coachingApi from '@/api/coaching';
import * as dashboardApi from '@/api/dashboard';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const FIVE_MINUTES = 5 * 60_000;
const TWO_MINUTES = 2 * 60_000;

export const dashboardKey = (workspaceId: string) => ['dashboard', workspaceId] as const;
export const skillTrendKey = (workspaceId: string) => ['skillTrend', workspaceId] as const;

/** GET /dashboard — cached server-side for 5 minutes, so the client matches that staleness rather than refetching aggressively (§7.3). */
export function useDashboard() {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  return useQuery({
    queryKey: dashboardKey(workspaceId ?? 'none'),
    queryFn: () => dashboardApi.getDashboard(),
    enabled: !!workspaceId,
    staleTime: FIVE_MINUTES,
  });
}

/**
 * GET /skill-trend — the 12-point series behind the sparkline. The
 * dashboard response only carries the latest single snapshot, so the
 * series needs this separate (server-cached, 2 min) call. Same key the
 * Progress screen (M6) will reuse.
 */
export function useSkillTrend() {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  return useQuery({
    queryKey: skillTrendKey(workspaceId ?? 'none'),
    queryFn: () => coachingApi.getSkillTrend().then((res) => res.trend),
    enabled: !!workspaceId,
    staleTime: TWO_MINUTES,
  });
}
