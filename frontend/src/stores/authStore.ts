import { create } from 'zustand';

import { secureStorage } from '@/utils/secureStorage';

/**
 * Auth tokens, persisted to expo-secure-store on native (not AsyncStorage
 * — tokens are sensitive, architecture doc §4.1 / §5) via the
 * secureStorage adapter, which falls back to localStorage on web, where
 * SecureStore has no implementation. This is plain Zustand state backed
 * manually by storage reads/writes rather than a persist middleware,
 * since the underlying API is async and a middleware adapter would hide
 * that.
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
      secureStorage.getItemAsync(ACCESS_TOKEN_KEY),
      secureStorage.getItemAsync(REFRESH_TOKEN_KEY),
      secureStorage.getItemAsync(EXPIRES_AT_KEY),
    ]);

    if (accessToken && refreshToken && expiresAt) {
      set({ tokens: { accessToken, refreshToken, expiresAt }, isHydrating: false });
    } else {
      set({ tokens: null, isHydrating: false });
    }
  },

  setTokens: async (tokens) => {
    await Promise.all([
      secureStorage.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
      secureStorage.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
      secureStorage.setItemAsync(EXPIRES_AT_KEY, tokens.expiresAt),
    ]);
    set({ tokens });
  },

  clearTokens: async () => {
    await Promise.all([
      secureStorage.deleteItemAsync(ACCESS_TOKEN_KEY),
      secureStorage.deleteItemAsync(REFRESH_TOKEN_KEY),
      secureStorage.deleteItemAsync(EXPIRES_AT_KEY),
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
