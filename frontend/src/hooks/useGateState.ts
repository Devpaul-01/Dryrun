import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useMe } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { isApiException } from '@/types/errors';

export type GateState =
  | { kind: 'loading' }
  | { kind: 'public' }
  | { kind: 'unverified' }
  | { kind: 'no-workspace' }
  | { kind: 'error'; retry: () => void }
  | { kind: 'app' };

/**
 * Single source of truth for "which part of the app may this session
 * see" (architecture doc §6's auth gate), evaluated reactively from the
 * root layout rather than once at boot. A one-shot redirect can't react
 * to later changes — login, logout, a failed token refresh, or an account
 * deletion all change this state while the user is already inside some
 * route group — so the root layout re-renders its route guards from this
 * hook instead.
 */
export function useGateState(): GateState {
  const queryClient = useQueryClient();
  const tokens = useAuthStore((state) => state.tokens);
  const authHydrating = useAuthStore((state) => state.isHydrating);
  const workspaceHydrating = useWorkspaceStore((state) => state.isHydrating);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const clearWorkspace = useWorkspaceStore((state) => state.clear);

  const hydrating = authHydrating || workspaceHydrating;
  const me = useMe({ enabled: !!tokens });
  const user = me.data;
  const serverWorkspaceId = user?.current_workspace_id ?? null;

  // Signed out by any path (logout, failed refresh, deleted account):
  // drop everything cached for the previous session so the next login
  // can never briefly render the previous user's data.
  useEffect(() => {
    if (!hydrating && !tokens) {
      queryClient.clear();
      void clearWorkspace();
    }
  }, [hydrating, tokens, queryClient, clearWorkspace]);

  // The server's current workspace is the source of truth; httpClient
  // sends the store's value as x-workspace-id, so they must agree before
  // any workspace-scoped request runs.
  useEffect(() => {
    if (serverWorkspaceId && serverWorkspaceId !== activeWorkspaceId) {
      void setActiveWorkspaceId(serverWorkspaceId);
    }
  }, [serverWorkspaceId, activeWorkspaceId, setActiveWorkspaceId]);

  if (hydrating) return { kind: 'loading' };
  if (!tokens) return { kind: 'public' };

  if (me.isPending) return { kind: 'loading' };
  if (me.isError) {
    // A final 401 already cleared the tokens inside httpClient; the next
    // render lands in 'public'. Anything else (offline, 5xx) must not
    // strand or silently sign out a user whose tokens are still valid.
    if (isApiException(me.error) && me.error.status === 401) return { kind: 'loading' };
    return { kind: 'error', retry: () => void me.refetch() };
  }
  if (!user) return { kind: 'loading' };

  if (!user.email_verified_at) return { kind: 'unverified' };
  if (!serverWorkspaceId) return { kind: 'no-workspace' };
  if (activeWorkspaceId !== serverWorkspaceId) return { kind: 'loading' };

  return { kind: 'app' };
}
