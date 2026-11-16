import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import * as debriefApi from '@/api/debrief';
import { sessionKey } from '@/hooks/useSessions';
import { useLastSessionStore } from '@/stores/lastSessionStore';

/** Async-result poll interval and the point at which we stop and tell the user it is taking longer than usual (§4.4, §7.8). */
export const RESULT_POLL_MS = 3000;
export const RESULT_GIVE_UP_MS = 90_000;

/**
 * Polls `fetcher`'s query at 3s until `isDone(data)`; after 90s stops and
 * reports `timedOut` so the screen can set expectations instead of looking
 * broken. `restart` re-arms polling (a manual "check again").
 */
function useAsyncResultPolling(isDone: boolean) {
  const [timedOut, setTimedOut] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (isDone) return;
    startedAt.current = Date.now();
    setTimedOut(false);
    const t = setTimeout(() => setTimedOut(true), RESULT_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [isDone, epoch]);

  return {
    timedOut,
    shouldPoll: !isDone && !timedOut,
    restart: () => setEpoch((e) => e + 1),
  };
}

export const debriefKey = (id: string) => ['debrief', id] as const;
export const sessionExportKey = (id: string) => ['sessionExport', id] as const;

export function useDebrief(sessionId: string | undefined) {
  const [done, setDone] = useState(false);
  const polling = useAsyncResultPolling(done);
  const query = useQuery({
    queryKey: debriefKey(sessionId ?? 'none'),
    queryFn: () => debriefApi.getDebrief(sessionId as string),
    enabled: !!sessionId,
    refetchInterval: polling.shouldPoll ? RESULT_POLL_MS : false,
    staleTime: (q) => (q.state.data ? Infinity : 0),
  });
  const ready = query.data != null;
  useEffect(() => setDone(ready), [ready]);
  return { ...query, ready, timedOut: polling.timedOut && !ready, checkAgain: polling.restart };
}

/** Skill scores + goal outcome; scores are `null` until the scoring job completes, so it polls the same way. */
export function useSessionResult(sessionId: string | undefined) {
  const [done, setDone] = useState(false);
  const polling = useAsyncResultPolling(done);
  const query = useQuery({
    queryKey: sessionExportKey(sessionId ?? 'none'),
    queryFn: () => debriefApi.getSessionExport(sessionId as string),
    enabled: !!sessionId,
    refetchInterval: polling.shouldPoll ? RESULT_POLL_MS : false,
    staleTime: (q) => (q.state.data?.skill_scores ? Infinity : 0),
  });
  const scored = query.data?.skill_scores != null;
  useEffect(() => setDone(scored), [scored]);
  return { ...query, scored, timedOut: polling.timedOut && !scored, checkAgain: polling.restart };
}

export function useReplay(sessionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['replay', sessionId ?? 'none'],
    queryFn: () => debriefApi.getReplay(sessionId as string),
    enabled: !!sessionId && enabled,
    staleTime: Infinity, // a completed session's transcript never changes
  });
}

export function useRetrySession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => debriefApi.retrySession(sessionId),
    onSuccess: (session) => {
      queryClient.setQueryData(sessionKey(session.id), session);
      void useLastSessionStore.getState().set(session.id);
    },
  });
}

/** Comparison of a retry against its original; polls until both sessions are scored. */
export function useComparison(retrySessionId: string | undefined) {
  const [done, setDone] = useState(false);
  const polling = useAsyncResultPolling(done);
  const query = useQuery({
    queryKey: ['comparison', retrySessionId ?? 'none'],
    queryFn: () => debriefApi.getComparison(retrySessionId as string),
    enabled: !!retrySessionId,
    refetchInterval: polling.shouldPoll ? RESULT_POLL_MS : false,
    staleTime: (q) => (q.state.data ? Infinity : 0),
  });
  const ready = query.data != null;
  useEffect(() => setDone(ready), [ready]);
  return { ...query, ready, timedOut: polling.timedOut && !ready, checkAgain: polling.restart };
}
