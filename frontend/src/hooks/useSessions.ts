import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as sessionsApi from '@/api/sessions';
import { useLastSessionStore } from '@/stores/lastSessionStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { CreateSessionRequest } from '@/types/requests';

export const sessionKey = (id: string) => ['session', id] as const;

export function useSession(id: string | undefined) {
  return useQuery({
    queryKey: sessionKey(id ?? 'none'),
    queryFn: () => sessionsApi.getSession(id as string),
    enabled: !!id,
  });
}

/**
 * POST /sessions. Slow without a persona_id (the backend generates one
 * inline), so callers show a dedicated "Building your buyer…" state while
 * `isPending`. Remembers the new session for cold-start recovery.
 */
export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSessionRequest) => sessionsApi.createSession(body),
    onSuccess: (session) => {
      queryClient.setQueryData(sessionKey(session.id), session);
      void useLastSessionStore.getState().set(session.id);
    },
  });
}

export function useEndSession(sessionId: string) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  return useMutation({
    mutationFn: () => sessionsApi.endSession(sessionId),
    onSuccess: () => finishSession(queryClient, sessionId, workspaceId),
  });
}

/** Shared by the manual end and the goal-achieved auto-end: forget the pointer and refresh what the end changes. */
export function finishSession(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  workspaceId: string | null,
) {
  void useLastSessionStore.getState().clear();
  void queryClient.invalidateQueries({ queryKey: sessionKey(sessionId) });
  if (workspaceId) void queryClient.invalidateQueries({ queryKey: ['dashboard', workspaceId] });
}
