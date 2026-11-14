import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * Active workspace id — sent as the x-workspace-id header on every
 * workspace-scoped request (architecture doc §2, §4.1). Persisted to
 * AsyncStorage since it's not sensitive, unlike auth tokens.
 */

const ACTIVE_WORKSPACE_ID_KEY = 'dryrun.workspace.activeId';

interface WorkspaceState {
  activeWorkspaceId: string | null;
  isHydrating: boolean;
  hydrate: () => Promise<void>;
  setActiveWorkspaceId: (workspaceId: string) => Promise<void>;
  clear: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeWorkspaceId: null,
  isHydrating: true,

  hydrate: async () => {
    const stored = await AsyncStorage.getItem(ACTIVE_WORKSPACE_ID_KEY);
    set({ activeWorkspaceId: stored, isHydrating: false });
  },

  // In-memory state updates first, persistence second: the running
  // session (x-workspace-id header, route guards) must see the change
  // immediately, not after a storage round-trip. A failed write only
  // costs the next cold start a re-seed from GET /auth/me.
  setActiveWorkspaceId: async (workspaceId) => {
    set({ activeWorkspaceId: workspaceId });
    await AsyncStorage.setItem(ACTIVE_WORKSPACE_ID_KEY, workspaceId);
  },

  clear: async () => {
    set({ activeWorkspaceId: null });
    await AsyncStorage.removeItem(ACTIVE_WORKSPACE_ID_KEY);
  },
}));

export function getActiveWorkspaceId(): string | null {
  return useWorkspaceStore.getState().activeWorkspaceId;
}
