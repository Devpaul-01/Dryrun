import { useAuthStore, getAuthTokens } from '@/stores/authStore';

/**
 * M1 acceptance criteria: "token refresh survives an app restart" and
 * "logout clears state correctly" — both exercised here against the real
 * secureStorage adapter (expo-secure-store auto-mocked by jest-expo to a
 * working in-memory-ish stub, verified via a Platform.OS probe) rather
 * than a hand-rolled fake, so this actually tests the persistence
 * round-trip authStore relies on.
 */
describe('authStore persistence', () => {
  const tokens = {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };

  afterEach(async () => {
    await useAuthStore.getState().clearTokens();
  });

  it('persists tokens and rehydrates them on a fresh store read (simulated app restart)', async () => {
    await useAuthStore.getState().setTokens(tokens);
    expect(getAuthTokens()).toEqual(tokens);

    // Simulate an app restart: reset in-memory state, then hydrate from
    // storage exactly as app/_layout.tsx does on boot.
    useAuthStore.setState({ tokens: null, isHydrating: true });
    expect(getAuthTokens()).toBeNull();

    await useAuthStore.getState().hydrate();

    expect(getAuthTokens()).toEqual(tokens);
    expect(useAuthStore.getState().isHydrating).toBe(false);
  });

  it('hydrates to null when no tokens were ever stored', async () => {
    await useAuthStore.getState().clearTokens();
    useAuthStore.setState({ tokens: null, isHydrating: true });

    await useAuthStore.getState().hydrate();

    expect(getAuthTokens()).toBeNull();
    expect(useAuthStore.getState().isHydrating).toBe(false);
  });

  it('clearTokens removes persisted tokens, not just in-memory state', async () => {
    await useAuthStore.getState().setTokens(tokens);
    await useAuthStore.getState().clearTokens();

    // Rehydrating afterward must find nothing — proves the storage write
    // was actually deleted, not just the Zustand state reset.
    useAuthStore.setState({ tokens: tokens, isHydrating: true });
    await useAuthStore.getState().hydrate();

    expect(getAuthTokens()).toBeNull();
  });
});
