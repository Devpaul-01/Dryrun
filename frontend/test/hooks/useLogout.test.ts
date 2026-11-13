import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import React from 'react';

import { queryClient } from '@/api/queryClient';
import { env } from '@/config/env';
import { useLogout } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import { server } from '../mocks/server';

const API = env.apiRoot;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

/**
 * M1 acceptance criteria: "logout clears state correctly" — tokens,
 * workspace, and the query cache (a stale cached GET /auth/me response
 * must not leak into the next session on the same device).
 */
describe('useLogout', () => {
  beforeEach(async () => {
    await useAuthStore.getState().setTokens({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await useWorkspaceStore.getState().setActiveWorkspaceId('workspace_1');
    queryClient.setQueryData(['me'], { id: 'user_1', email: 'a@b.com' });
  });

  afterEach(async () => {
    await useAuthStore.getState().clearTokens();
    await useWorkspaceStore.getState().clear();
    queryClient.clear();
  });

  it('clears tokens, workspace, and the query cache when the network call succeeds', async () => {
    server.use(http.post(`${API}/auth/logout`, () => HttpResponse.json({ success: true })));

    const { result, unmount } = await renderHook(() => useLogout(), { wrapper });
    result.current.mutate(undefined);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(useAuthStore.getState().tokens).toBeNull();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    expect(queryClient.getQueryData(['me'])).toBeUndefined();

    // Unmounting stops React Query's internal gc/retry timers for this
    // hook's mutation observer — without it, a real (non-fake) setTimeout
    // handle survives the test and keeps the Jest process alive on exit.
    unmount();
  });

  it('still clears local state when the network call fails', async () => {
    server.use(
      http.post(`${API}/auth/logout`, () =>
        HttpResponse.json({ error: 'INTERNAL' }, { status: 500 }),
      ),
    );

    const { result, unmount } = await renderHook(() => useLogout(), { wrapper });
    result.current.mutate(undefined);

    await waitFor(() => expect(result.current.isError).toBe(true));

    // A user who tapped "log out" ends up logged out locally regardless
    // of connectivity (onSettled, not onSuccess) — see useAuth.ts.
    expect(useAuthStore.getState().tokens).toBeNull();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    expect(queryClient.getQueryData(['me'])).toBeUndefined();

    unmount();
  });
});
