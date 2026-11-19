import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * An emailed invite token that arrived while signed out. Held until the
 * user is signed in and in the app, then the accept screen consumes it.
 * The token is a short-lived (7-day), single-use secret, so it's kept
 * only until consumed and never logged.
 */
const KEY = 'dryrun.invite.pendingToken';

interface PendingInviteState {
  token: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  set: (token: string) => Promise<void>;
  clear: () => Promise<void>;
}

export const usePendingInviteStore = create<PendingInviteState>((set) => ({
  token: null,
  hydrated: false,
  hydrate: async () => {
    let stored: string | null = null;
    try {
      stored = await AsyncStorage.getItem(KEY);
    } catch {
      /* best effort */
    }
    set({ token: stored, hydrated: true });
  },
  set: async (token) => {
    set({ token });
    try {
      await AsyncStorage.setItem(KEY, token);
    } catch {
      /* best effort */
    }
  },
  clear: async () => {
    set({ token: null });
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      /* best effort */
    }
  },
}));
