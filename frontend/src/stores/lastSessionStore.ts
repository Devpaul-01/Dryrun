import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * Remembers the in-progress session so a cold start can resume it
 * (architecture doc §4.5). Non-sensitive, so AsyncStorage. The session
 * itself is always re-fetched from the backend; this is only a pointer.
 */
const KEY = 'dryrun.session.lastActiveId';

interface LastSessionState {
  lastActiveSessionId: string | null;
  isHydrating: boolean;
  hydrate: () => Promise<void>;
  set: (sessionId: string) => Promise<void>;
  clear: () => Promise<void>;
}

export const useLastSessionStore = create<LastSessionState>((set) => ({
  lastActiveSessionId: null,
  isHydrating: true,
  hydrate: async () => {
    const stored = await AsyncStorage.getItem(KEY);
    set({ lastActiveSessionId: stored, isHydrating: false });
  },
  set: async (sessionId) => {
    set({ lastActiveSessionId: sessionId });
    await AsyncStorage.setItem(KEY, sessionId);
  },
  clear: async () => {
    set({ lastActiveSessionId: null });
    await AsyncStorage.removeItem(KEY);
  },
}));
