import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import * as sessionsApi from '@/api/sessions';
import { finishSession } from '@/hooks/useSessions';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { LiveTurnState, PracticeSession, SessionMessage } from '@/types/api';
import { isApiException } from '@/types/errors';
import { generateIdempotencyKey } from '@/utils/idempotencyKey';
import {
  SEED_LIVE_STATE,
  canSend,
  initialLiveSessionState,
  liveSessionReducer,
} from '@/utils/liveSession';

const MAX_HISTORY_PAGES = 10;

/** The backend exposes no endpoint for the latest live_state, so a resumed session starts from the persona's seed values. */
export function seedLiveState(session: PracticeSession): LiveTurnState {
  return {
    ...SEED_LIVE_STATE,
    interest: session.persona_snapshot?.interest_score ?? SEED_LIVE_STATE.interest,
    trust: session.persona_snapshot?.trust_score ?? SEED_LIVE_STATE.trust,
  };
}

async function loadHistory(sessionId: string): Promise<SessionMessage[]> {
  const pages: SessionMessage[][] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_HISTORY_PAGES; i++) {
    const page = await sessionsApi.listMessages(sessionId, cursor);
    pages.unshift(page.items); // each page is oldest-first; next page is older
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return pages.flat();
}

let counter = 0;
const nextLocalId = () => `local-${Date.now()}-${counter++}`;

/**
 * Drives the live simulation screen (architecture doc §7.5, §8): loads
 * history, owns the optimistic send / failed-retry lifecycle, and exposes
 * `ended` so the screen can route to the ending flow.
 */
export function useLiveSession(session: PracticeSession | undefined) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const [state, dispatch] = useReducer(liveSessionReducer, undefined, () => initialLiveSessionState());
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [endError, setEndError] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const sessionId = session?.id;
  const sessionStatus = session?.status;

  const loadedFor = useRef<string | null>(null);
  const loadHistoryNow = useCallback(async () => {
    if (!session) return;
    setHistoryStatus('loading');
    try {
      const messages = await loadHistory(session.id);
      dispatch({ type: 'hydrate', messages, live: seedLiveState(session) });
      setHistoryStatus('ready');
    } catch {
      setHistoryStatus('error');
    }
    // session identity is keyed by id; re-hydrating on every refetch would clobber optimistic items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || loadedFor.current === sessionId) return;
    loadedFor.current = sessionId;
    void loadHistoryNow();
  }, [sessionId, loadHistoryNow]);

  // A session that is not active (ended elsewhere) can never accept input.
  useEffect(() => {
    if (sessionStatus && sessionStatus !== 'active') dispatch({ type: 'markEnded' });
  }, [sessionStatus]);

  const attempt = useCallback(
    async (localId: string, content: string, key: string) => {
      if (!sessionId) return;
      try {
        const response = await sessionsApi.sendMessage(sessionId, { content }, key);
        dispatch({ type: 'reply', localId, replyLocalId: nextLocalId(), response });
        if (response.goal_achieved) finishSession(queryClient, sessionId, workspaceId);
      } catch (error) {
        if (isApiException(error) && error.status === 409) {
          // The session already ended (e.g. elsewhere): drop the optimistic bubble's retry path entirely.
          dispatch({ type: 'markEnded' });
          finishSession(queryClient, sessionId, workspaceId);
          return;
        }
        dispatch({ type: 'fail', localId });
      }
    },
    [sessionId, queryClient, workspaceId],
  );

  const send = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || !canSend(stateRef.current)) return false;
      const localId = nextLocalId();
      const key = generateIdempotencyKey();
      dispatch({ type: 'send', localId, content: trimmed, idempotencyKey: key });
      void attempt(localId, trimmed, key);
      return true;
    },
    [attempt],
  );

  const retry = useCallback(
    (localId: string) => {
      const item = stateRef.current.items.find((i) => i.localId === localId);
      if (!item || item.status !== 'failed' || !item.idempotencyKey) return;
      dispatch({ type: 'retry', localId });
      void attempt(localId, item.content, item.idempotencyKey);
    },
    [attempt],
  );

  const keepGoing = useCallback(() => {
    dispatch({ type: 'keepGoing' });
    if (sessionId) void sessionsApi.continueSession(sessionId).catch(() => undefined); // informational only
  }, [sessionId]);

  /** Ends the session on the server. Resolves true on success; on failure sets `endError` and leaves the chat usable. */
  const end = useCallback(async () => {
    if (!sessionId) return false;
    setEndError(null);
    try {
      await sessionsApi.endSession(sessionId);
      dispatch({ type: 'markEnded' });
      finishSession(queryClient, sessionId, workspaceId);
      return true;
    } catch {
      setEndError('Could not end the session. Please try again.');
      return false;
    }
  }, [sessionId, queryClient, workspaceId]);

  return { state, historyStatus, reloadHistory: loadHistoryNow, send, retry, keepGoing, end, endError };
}
