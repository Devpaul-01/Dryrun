import { httpClient } from '@/api/httpClient';
import type { CursorPage, PracticeSession, SendMessageResponse, SessionListItem, SessionMessage } from '@/types/api';
import type { CreateSessionRequest, ListSessionsRequest, SendMessageRequest } from '@/types/requests';

/**
 * AI-backed calls (inline persona generation, a live turn) can outlast the
 * 30s default, especially on provider fallback. A timed-out send is safe to
 * retry because it carries an Idempotency-Key.
 */
const AI_TIMEOUT_MS = 90_000;

export function createSession(body: CreateSessionRequest) {
  return httpClient
    .post<{ session: PracticeSession }>('/sessions', body, { timeout: AI_TIMEOUT_MS })
    .then((res) => res.data.session);
}

export function getSession(id: string) {
  return httpClient.get<{ session: PracticeSession }>(`/sessions/${id}`).then((res) => res.data.session);
}

/** Oldest-first within a page; `next_cursor` points at older messages. */
export function listMessages(id: string, cursor?: string) {
  return httpClient
    .get<CursorPage<SessionMessage>>(`/sessions/${id}/messages`, {
      params: { limit: 200, ...(cursor ? { cursor } : {}) },
    })
    .then((res) => res.data);
}

export function sendMessage(id: string, body: SendMessageRequest, idempotencyKey: string) {
  return httpClient
    .post<SendMessageResponse>(`/sessions/${id}/messages`, body, {
      headers: { 'Idempotency-Key': idempotencyKey },
      timeout: AI_TIMEOUT_MS,
    })
    .then((res) => res.data);
}

export function continueSession(id: string) {
  return httpClient
    .post<{ extra_exchanges_allowed: number }>(`/sessions/${id}/continue`)
    .then((res) => res.data);
}

export function endSession(id: string) {
  return httpClient.post<{ already_completed: boolean }>(`/sessions/${id}/end`).then((res) => res.data);
}

export function listSessions(params: ListSessionsRequest) {
  return httpClient
    .get<CursorPage<SessionListItem>>('/sessions', {
      params: {
        ...(params.cursor ? { cursor: params.cursor } : {}),
        ...(params.archived ? { archived: true } : {}),
        ...(params.scenario_type ? { scenario_type: params.scenario_type } : {}),
        ...(params.search?.trim() ? { search: params.search.trim() } : {}),
      },
    })
    .then((res) => res.data);
}

export function renameSession(id: string, title: string) {
  return httpClient.patch<{ session: PracticeSession }>(`/sessions/${id}`, { title }).then((res) => res.data.session);
}

export function archiveSession(id: string) {
  return httpClient.post<{ success: boolean }>(`/sessions/${id}/archive`).then((res) => res.data);
}

export function unarchiveSession(id: string) {
  return httpClient.post<{ success: boolean }>(`/sessions/${id}/unarchive`).then((res) => res.data);
}

/** 409 for completed sessions (they feed skill tracking); the UI therefore only offers this for pending/active ones. */
export function deleteSession(id: string) {
  return httpClient.delete<{ success: boolean }>(`/sessions/${id}`).then((res) => res.data);
}
