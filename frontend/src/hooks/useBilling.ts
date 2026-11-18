import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as billingApi from '@/api/billing';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { WorkspaceRole } from '@/types/api';

const useWs = () => useWorkspaceStore((s) => s.activeWorkspaceId) ?? 'none';

/** The signed-in user's role in the active workspace (from GET /workspaces), or null while unknown. */
export function useActiveRole(): WorkspaceRole | null {
  const ws = useWs();
  const workspaces = useWorkspaces();
  return workspaces.data?.find((w) => w.id === ws)?.role ?? null;
}

export const plansKey = ['plans'] as const; // plans are global, not workspace-scoped
export const subscriptionKey = (ws: string) => ['subscription', ws] as const;
export const usageKey = (ws: string) => ['usage', ws] as const;

export function usePlans() {
  return useQuery({ queryKey: plansKey, queryFn: billingApi.listPlans, staleTime: 5 * 60_000 });
}

/** Owner/admin only on the backend; callers gate on useActiveRole and pass `enabled`. */
export function useSubscription(enabled = true) {
  const ws = useWs();
  return useQuery({ queryKey: subscriptionKey(ws), queryFn: billingApi.getSubscription, enabled });
}

export function useUsage() {
  const ws = useWs();
  return useQuery({ queryKey: usageKey(ws), queryFn: billingApi.getUsage });
}

export function useInvoices(enabled = true) {
  const ws = useWs();
  return useInfiniteQuery({
    queryKey: ['invoices', ws],
    queryFn: ({ pageParam }) => billingApi.listInvoices(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });
}

function useRefreshBilling() {
  const queryClient = useQueryClient();
  const ws = useWs();
  return () => {
    void queryClient.invalidateQueries({ queryKey: subscriptionKey(ws) });
    void queryClient.invalidateQueries({ queryKey: usageKey(ws) });
    void queryClient.invalidateQueries({ queryKey: ['invoices', ws] });
  };
}

export function useStartCheckout() {
  return useMutation({ mutationFn: (planKey: string) => billingApi.startCheckout(planKey) });
}

export function useConfirmCheckout() {
  const refresh = useRefreshBilling();
  return useMutation({ mutationFn: (txRef: string) => billingApi.confirmCheckout(txRef), onSuccess: refresh });
}

export function useChangePlan() {
  const refresh = useRefreshBilling();
  return useMutation({ mutationFn: (planKey: string) => billingApi.changePlan(planKey), onSuccess: refresh });
}

export function useCancelSubscription() {
  const refresh = useRefreshBilling();
  return useMutation({ mutationFn: () => billingApi.cancelSubscription(), onSuccess: refresh });
}

export function useReactivateSubscription() {
  const refresh = useRefreshBilling();
  return useMutation({ mutationFn: () => billingApi.reactivateSubscription(), onSuccess: refresh });
}
