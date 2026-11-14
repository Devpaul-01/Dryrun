import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as onboardingApi from '@/api/onboarding';
import type { OnboardingStatusResponse } from '@/types/dashboard';
import type { InstantSetupRequest } from '@/types/requests';

/** Per-workspace (architecture doc §2.4): the same user can be onboarded in one workspace and not another. */
export const onboardingStatusKey = (workspaceId: string) => ['onboarding', workspaceId] as const;

/**
 * Once a workspace reports completed it never reverts, so a `true` answer
 * is cached for the session; a `false` is re-checked on mount in case
 * setup finished on another device.
 */
export function useOnboardingStatus(workspaceId: string | null, enabled = true) {
  return useQuery({
    queryKey: onboardingStatusKey(workspaceId ?? 'none'),
    queryFn: () => onboardingApi.getOnboardingStatus(),
    enabled: enabled && !!workspaceId,
    staleTime: (query) => (query.state.data?.onboarding_completed ? Infinity : 0),
  });
}

/**
 * On success, writes `completed: true` straight into the status cache so
 * the gate routes into the app immediately (no second confirmation step,
 * §7.2) and refreshes the dashboard, which a completed setup affects.
 */
export function useInstantSetup(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: InstantSetupRequest) => onboardingApi.instantSetup(body),
    onSuccess: () => {
      queryClient.setQueryData<OnboardingStatusResponse>(onboardingStatusKey(workspaceId), {
        onboarding_completed: true,
      });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', workspaceId] });
    },
  });
}
