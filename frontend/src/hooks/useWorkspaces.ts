import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as workspacesApi from '@/api/workspaces';
import { ME_QUERY_KEY } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { User } from '@/types/api';

/** Not workspace-scoped: it lists the workspaces themselves. */
export const WORKSPACES_QUERY_KEY = ['workspaces'] as const;

export function useWorkspaces() {
  const hasTokens = useAuthStore((state) => state.tokens !== null);
  return useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: () => workspacesApi.listWorkspaces().then((res) => res.workspaces),
    enabled: hasTokens,
    staleTime: 60_000,
  });
}

/**
 * Persists the new default server-side, then updates the local active id
 * (which httpClient sends as x-workspace-id from the next request on).
 * Workspace-scoped query keys embed the workspace id (§4.2), so cached
 * data for the previous workspace can't be mistaken for the new one; only
 * the user's own record needs refreshing for current_workspace_id.
 */
export function useSwitchWorkspace() {
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (workspaceId: string) => workspacesApi.switchWorkspace({ workspace_id: workspaceId }),
    onSuccess: async ({ workspace }) => {
      // The store's in-memory update runs synchronously inside the call,
      // so it and the cached-user update below land in the same React
      // batch — the gate's "server workspace vs local workspace" check
      // never sees them disagree mid-switch.
      const persisted = setActiveWorkspaceId(workspace.id);
      queryClient.setQueryData<User>(ME_QUERY_KEY, (user) =>
        user ? { ...user, current_workspace_id: workspace.id } : user,
      );
      await persisted;
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}

// ---- Team management ----
const wsId = () => useWorkspaceStore.getState().activeWorkspaceId ?? 'none';

export function useWorkspaceMembers() {
  const ws = useWorkspaceStore((s) => s.activeWorkspaceId) ?? 'none';
  return useInfiniteQuery({
    queryKey: ['members', ws],
    queryFn: ({ pageParam }) => workspacesApi.listMembers(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useTeamProgress(enabled: boolean) {
  const ws = useWorkspaceStore((s) => s.activeWorkspaceId) ?? 'none';
  return useQuery({ queryKey: ['team-progress', ws], queryFn: workspacesApi.getTeamProgress, enabled });
}

function useMembersMutation<TVars, TData>(fn: (v: TVars) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', wsId()] });
      void queryClient.invalidateQueries({ queryKey: ['team-progress', wsId()] });
    },
  });
}

export const useInviteMember = () =>
  useMembersMutation((v: { email: string; role: 'admin' | 'member' }) => workspacesApi.inviteMember(v.email, v.role));
export const useRemoveMember = () => useMembersMutation((memberId: string) => workspacesApi.removeMember(memberId));
export const useSetMemberRole = () =>
  useMembersMutation((v: { memberId: string; role: 'admin' | 'member' }) => workspacesApi.setMemberRole(v.memberId, v.role));
export const useTransferOwnership = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => workspacesApi.transferOwnership(userId),
    // Roles of two people changed, and our own role with it.
    onSuccess: () => void queryClient.invalidateQueries(),
  });
};

export function useRenameWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => workspacesApi.renameWorkspace(name),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
  });
}

/**
 * Leaves the active workspace, then moves the user into another one they
 * belong to (the active id would otherwise point at a workspace they can no
 * longer use). Resolves to whether another workspace was available.
 */
export function useLeaveWorkspace() {
  const queryClient = useQueryClient();
  const switchWorkspace = useSwitchWorkspace();
  return useMutation({
    mutationFn: async (): Promise<boolean> => {
      const leftId = useWorkspaceStore.getState().activeWorkspaceId;
      await workspacesApi.leaveWorkspace();
      const { workspaces } = await workspacesApi.listWorkspaces();
      const next = workspaces.find((w) => w.id !== leftId);
      if (!next) return false;
      await switchWorkspace.mutateAsync(next.id);
      return true;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
  });
}

/** Accepts an emailed invite token, then makes that workspace the active one. */
export function useAcceptInvite() {
  const queryClient = useQueryClient();
  const switchWorkspace = useSwitchWorkspace();
  return useMutation({
    mutationFn: async (token: string) => {
      const result = await workspacesApi.acceptInvite(token);
      await switchWorkspace.mutateAsync(result.workspaceId);
      return result;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
  });
}
