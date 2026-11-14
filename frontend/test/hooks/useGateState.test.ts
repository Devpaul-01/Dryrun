import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import React from 'react';

import { queryClient } from '@/api/queryClient';
import { env } from '@/config/env';
import { useGateState } from '@/hooks/useGateState';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import { mockUser } from '../mocks/data';
import { server } from '../mocks/server';

const API = env.apiRoot;
const tokens = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function meReturns(overrides: Record<string, unknown>) {
  server.use(
    http.get(`${API}/auth/me`, () => HttpResponse.json({ user: { ...mockUser, ...overrides } })),
  );
}

async function signIn() {
  useAuthStore.setState({ tokens, isHydrating: false });
}

describe('useGateState', () => {
  beforeEach(() => {
    useAuthStore.setState({ tokens: null, isHydrating: false });
    useWorkspaceStore.setState({ activeWorkspaceId: null, isHydrating: false });
  });
  afterEach(() => {
    queryClient.clear();
  });

  it('is loading until both stores have hydrated', async () => {
    useAuthStore.setState({ isHydrating: true });
    const { result, unmount } = await renderHook(() => useGateState(), { wrapper });
    expect(result.current.kind).toBe('loading');
    unmount();
  });

  it('is public with no tokens', async () => {
    const { result, unmount } = await renderHook(() => useGateState(), { wrapper });
    expect(result.current.kind).toBe('public');
    unmount();
  });

  it('is unverified when the email is not verified', async () => {
    meReturns({ email_verified_at: null, current_workspace_id: 'ws_1' });
    await signIn();
    const { result, unmount } = await renderHook(() => useGateState(), { wrapper });
    await waitFor(() => expect(result.current.kind).toBe('unverified'));
    unmount();
  });

  it('is no-workspace when the user has no current workspace', async () => {
    meReturns({ email_verified_at: '2026-01-01T00:00:00Z', current_workspace_id: null });
    await signIn();
    const { result, unmount } = await renderHook(() => useGateState(), { wrapper });
    await waitFor(() => expect(result.current.kind).toBe('no-workspace'));
    unmount();
  });

  it('seeds the workspace store from the server, then reaches app', async () => {
    meReturns({ email_verified_at: '2026-01-01T00:00:00Z', current_workspace_id: 'ws_1' });
    await signIn();
    const { result, unmount } = await renderHook(() => useGateState(), { wrapper });
    await waitFor(() => expect(result.current.kind).toBe('app'));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws_1');
    unmount();
  });

  it('shows a retryable error on a server failure instead of signing the user out', async () => {
    server.use(http.get(`${API}/auth/me`, () => HttpResponse.json({ error: 'X' }, { status: 500 })));
    await signIn();
    const { result, unmount } = await renderHook(() => useGateState(), { wrapper });
    await waitFor(() => expect(result.current.kind).toBe('error'), { timeout: 5000 });
    expect(useAuthStore.getState().tokens).not.toBeNull();
    unmount();
  });

  it('drops to public and clears cached data when tokens disappear (logout, failed refresh)', async () => {
    meReturns({ email_verified_at: '2026-01-01T00:00:00Z', current_workspace_id: 'ws_1' });
    await signIn();
    const { result, unmount } = await renderHook(() => useGateState(), { wrapper });
    await waitFor(() => expect(result.current.kind).toBe('app'));

    useAuthStore.setState({ tokens: null });

    await waitFor(() => expect(result.current.kind).toBe('public'));
    await waitFor(() => expect(queryClient.getQueryData(['me'])).toBeUndefined());
    await waitFor(() => expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull());
    unmount();
  });
});
