import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as workspacesApi from '@/api/workspaces';
import { ME_QUERY_KEY } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

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
      await setActiveWorkspaceId(workspace.id);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}
