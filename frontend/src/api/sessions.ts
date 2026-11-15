import { httpClient } from '@/api/httpClient';
import type { CursorPage, PracticeSession, SendMessageResponse, SessionMessage } from '@/types/api';
import type { CreateSessionRequest, SendMessageRequest } from '@/types/requests';

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
