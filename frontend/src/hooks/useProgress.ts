import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as progressApi from '@/api/progress';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const wsId = () => useWorkspaceStore.getState().activeWorkspaceId ?? 'none';

export const goalRatesKey = (workspaceId: string) => ['goalRates', workspaceId] as const;
export const badgesKey = (workspaceId: string) => ['badges', workspaceId] as const;
export const curriculumKey = (workspaceId: string) => ['curriculum', workspaceId] as const;

export function useGoalRates() {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId) ?? 'none';
  return useQuery({ queryKey: goalRatesKey(workspaceId), queryFn: progressApi.getGoalRates, enabled: workspaceId !== 'none', staleTime: 2 * 60_000 });
}

export function useBadges() {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId) ?? 'none';
  return useQuery({ queryKey: badgesKey(workspaceId), queryFn: progressApi.getBadges, enabled: workspaceId !== 'none', staleTime: 5 * 60_000 });
}

export function useCurriculum() {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId) ?? 'none';
  return useQuery({ queryKey: curriculumKey(workspaceId), queryFn: progressApi.getCurrentCurriculum, enabled: workspaceId !== 'none', staleTime: 2 * 60_000 });
}

/**
 * Dismisses the active plan. The plan is shared between Progress and the
 * dashboard, so both caches are updated on success; the optimistic clear
 * is rolled back if the call fails.
 */
export function useDismissCurriculum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (curriculumId: string) => progressApi.dismissCurriculum(curriculumId),
    onMutate: async () => {
      const key = curriculumKey(wsId());
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, null);
      return { previous, key };
    },
    onError: (_e, _id, ctx) => {
      if (ctx) queryClient.setQueryData(ctx.key, ctx.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: curriculumKey(wsId()) });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', wsId()] });
    },
  });
}
