import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

/**
 * Auth tokens, persisted to expo-secure-store (not AsyncStorage — tokens
 * are sensitive, architecture doc §4.1 / §5). This is plain Zustand state
 * backed manually by SecureStore reads/writes rather than a persist
 * middleware, since SecureStore's API is async and a middleware adapter
 * would hide that.
 */

const ACCESS_TOKEN_KEY = 'dryrun.auth.accessToken';
const REFRESH_TOKEN_KEY = 'dryrun.auth.refreshToken';
const EXPIRES_AT_KEY = 'dryrun.auth.expiresAt';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp from the backend's {expires_at} (architecture doc §2.1). */
  expiresAt: string;
}

interface AuthState {
  tokens: AuthTokens | null;
  /** True until the initial SecureStore read on app boot completes. */
  isHydrating: boolean;
  hydrate: () => Promise<void>;
  setTokens: (tokens: AuthTokens) => Promise<void>;
  clearTokens: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  tokens: null,
  isHydrating: true,

  hydrate: async () => {
    const [accessToken, refreshToken, expiresAt] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.getItemAsync(EXPIRES_AT_KEY),
    ]);

    if (accessToken && refreshToken && expiresAt) {
      set({ tokens: { accessToken, refreshToken, expiresAt }, isHydrating: false });
    } else {
      set({ tokens: null, isHydrating: false });
    }
  },

  setTokens: async (tokens) => {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
      SecureStore.setItemAsync(EXPIRES_AT_KEY, tokens.expiresAt),
    ]);
    set({ tokens });
  },

  clearTokens: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.deleteItemAsync(EXPIRES_AT_KEY),
    ]);
    set({ tokens: null });
  },
}));

/**
 * Non-reactive accessor for use outside React (the http client's
 * interceptors run far from any component tree).
 */
export function getAuthTokens(): AuthTokens | null {
  return useAuthStore.getState().tokens;
}
