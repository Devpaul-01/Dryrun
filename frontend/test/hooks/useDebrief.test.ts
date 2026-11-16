import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import React from 'react';

import { queryClient } from '@/api/queryClient';
import { env } from '@/config/env';
import { useComparison, useDebrief } from '@/hooks/useDebrief';

import { server } from '../mocks/server';

const API = env.apiRoot;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: queryClient }, children);

const debrief = {
  session_id: 's1',
  strength: 'Clear opener',
  improvement: 'Ask more questions',
  coachable_moment: 'Turn 3',
  goal_reference: null,
  generated_at: '2026-01-01T00:00:00Z',
};

describe('async result polling', () => {
  afterEach(() => queryClient.clear());

  it('polls a null debrief until it arrives, then stops', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/sessions/s1/debrief`, () => {
        calls += 1;
        return HttpResponse.json({ debrief: calls < 2 ? null : debrief });
      }),
    );
    const { result, unmount } = await renderHook(() => useDebrief('s1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true), { timeout: 6000 });
    expect(result.current.data?.strength).toBe('Clear opener');

    const settled = calls;
    await new Promise((r) => setTimeout(r, 3500));
    expect(calls).toBe(settled);
    unmount();
  }, 15000);

  it('treats a null comparison as not-ready and populates once both sessions are scored', async () => {
    let calls = 0;
    const comparison = {
      original_scores: {}, retry_scores: {}, deltas: {}, original_goal_achieved: false, retry_goal_achieved: true, summary: 'Better',
    };
    server.use(
      http.get(`${API}/sessions/r1/comparison`, () => {
        calls += 1;
        return HttpResponse.json({ comparison: calls < 2 ? null : comparison });
      }),
    );
    const { result, unmount } = await renderHook(() => useComparison('r1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true), { timeout: 6000 });
    expect(result.current.data?.summary).toBe('Better');
    unmount();
  }, 15000);
});
