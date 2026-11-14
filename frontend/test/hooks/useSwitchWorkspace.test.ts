import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import React from 'react';

import { queryClient } from '@/api/queryClient';
import { env } from '@/config/env';
import { useSwitchWorkspace } from '@/hooks/useWorkspaces';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import { server } from '../mocks/server';

const API = env.apiRoot;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useSwitchWorkspace', () => {
  afterEach(async () => {
    await useWorkspaceStore.getState().clear();
    queryClient.clear();
  });

  it('posts the target id, then updates the active workspace and refreshes the user', async () => {
    await useWorkspaceStore.getState().setActiveWorkspaceId('ws_old');
    queryClient.setQueryData(['me'], { id: 'u1' });
    let postedBody: unknown;

    server.use(
      http.post(`${API}/workspaces/current/switch`, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json({
          workspace: {
            id: 'ws_new',
            name: 'New',
            owner_user_id: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        });
      }),
    );

    const { result, unmount } = await renderHook(() => useSwitchWorkspace(), { wrapper });
    result.current.mutate('ws_new');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(postedBody).toEqual({ workspace_id: 'ws_new' });
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws_new');
    expect(queryClient.getQueryState(['me'])?.isInvalidated).toBe(true);
    unmount();
  });

  it('leaves the active workspace unchanged when the switch fails', async () => {
    await useWorkspaceStore.getState().setActiveWorkspaceId('ws_old');
    server.use(
      http.post(`${API}/workspaces/current/switch`, () =>
        HttpResponse.json({ error: 'FORBIDDEN', message: 'Not a member.' }, { status: 403 }),
      ),
    );

    const { result, unmount } = await renderHook(() => useSwitchWorkspace(), { wrapper });
    result.current.mutate('ws_other');
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws_old');
    unmount();
  });
});
