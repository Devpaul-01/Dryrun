import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * A screen to open after the user's first login — set when a demo is
 * converted into an account that still needs email verification. Bound to the
 * email it was created for so a different account never lands on it.
 */
const KEY = 'dryrun.pendingRoute';

export interface PendingRoute {
  email: string;
  path: string;
}

interface State {
  pending: PendingRoute | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  set: (p: PendingRoute) => Promise<void>;
  clear: () => Promise<void>;
}

export const usePendingRouteStore = create<State>((set) => ({
  pending: null,
  hydrated: false,
  hydrate: async () => {
    let stored: PendingRoute | null = null;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      stored = raw ? (JSON.parse(raw) as PendingRoute) : null;
    } catch {
      /* best effort */
    }
    set({ pending: stored, hydrated: true });
  },
  set: async (p) => {
    set({ pending: p });
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* best effort */
    }
  },
  clear: async () => {
    set({ pending: null });
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      /* best effort */
    }
  },
}));
