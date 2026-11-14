import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
