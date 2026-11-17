import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import React from 'react';

import { queryClient } from '@/api/queryClient';
import { env } from '@/config/env';
import { useCreatePlaybook } from '@/hooks/usePlaybooks';
import { useArchiveSession, useSessionHistory } from '@/hooks/useSessionHistory';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import { server } from '../mocks/server';

// jest-expo auto-mocks expo-crypto to a no-op; a real UUID is needed to observe the Idempotency-Key header.
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));

const API = env.apiRoot;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: queryClient }, children);

const row = (id: string) => ({ id, title: id, scenario_type: 'skeptic', status: 'completed', archived_at: null, created_at: '', completed_at: '' });

beforeEach(() => {
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws1' });
});
afterEach(() => queryClient.clear());

const useHistoryWithArchive = () => ({ list: useSessionHistory({}), archive: useArchiveSession() });

describe('session history row actions', () => {
  it('removes an archived row immediately and keeps it removed on success', async () => {
    let archived = false;
    server.use(
      http.get(`${API}/sessions`, () => HttpResponse.json({ items: archived ? [row('b')] : [row('a'), row('b')], next_cursor: null })),
      http.post(`${API}/sessions/a/archive`, () => {
        archived = true;
        return HttpResponse.json({ success: true });
      }),
    );
    const { result, unmount } = await renderHook(useHistoryWithArchive, { wrapper });
    await waitFor(() => expect(result.current?.list.data?.pages[0].items).toHaveLength(2));
    result.current.archive.mutate({ id: 'a', archive: true });
    await waitFor(() => expect(result.current.list.data?.pages[0].items.map((i) => i.id)).toEqual(['b']));
    await waitFor(() => expect(result.current.archive.isSuccess).toBe(true));
    unmount();
  });

  it('rolls the row back when the request fails', async () => {
    server.use(
      http.get(`${API}/sessions`, () => HttpResponse.json({ items: [row('a')], next_cursor: null })),
      http.post(`${API}/sessions/a/archive`, () => HttpResponse.json({ error: 'X', message: 'no' }, { status: 500 })),
    );
    const { result, unmount } = await renderHook(useHistoryWithArchive, { wrapper });
    await waitFor(() => expect(result.current?.list.data?.pages[0].items).toHaveLength(1));
    result.current.archive.mutate({ id: 'a', archive: true });
    await waitFor(() => expect(result.current.archive.isError).toBe(true));
    await waitFor(() => expect(result.current.list.data?.pages[0].items).toHaveLength(1));
    unmount();
  });
});

describe('useCreatePlaybook idempotency', () => {
  it('reuses the key across a retry of the same intent, then rotates after success', async () => {
    const keys: (string | null)[] = [];
    let fail = true;
    const playbook = { id: 'pb1', title: 't', share_token: null, share_attribution_enabled: true, created_at: '', playbook_versions: { version_number: 1, opening_message: 'o', discovery_questions: [], objection_responses: [], closing_cta: 'c', key_insight: 'k', created_at: '' } };
    server.use(
      http.post(`${API}/playbooks`, ({ request }) => {
        keys.push(request.headers.get('idempotency-key'));
        if (fail) {
          fail = false;
          return HttpResponse.json({ error: 'X', message: 'boom' }, { status: 500 });
        }
        return HttpResponse.json({ playbook }, { status: 201 });
      }),
    );
    const { result, unmount } = await renderHook(() => useCreatePlaybook(), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    result.current.mutate({ session_id: 's1' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    result.current.mutate({ session_id: 's1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(result.current.data?.current_version.opening_message).toBe('o'); // join normalised

    result.current.mutate({ session_id: 's2' });
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[0]);
    unmount();
  });
});
