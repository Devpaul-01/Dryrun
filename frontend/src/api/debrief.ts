import { httpClient } from '@/api/httpClient';
import type {
  PracticeSession,
  SessionComparison,
  SessionDebrief,
  SessionExport,
  SessionReplay,
} from '@/types/api';

/** `null` while the async debrief job has not finished. */
export function getDebrief(id: string) {
  return httpClient.get<{ debrief: SessionDebrief | null }>(`/sessions/${id}/debrief`).then((res) => res.data.debrief);
}

export function getSessionExport(id: string) {
  return httpClient
    .get<SessionExport>(`/sessions/${id}/export`, { params: { format: 'json' } })
    .then((res) => res.data);
}

/** 400 unless the session is completed. */
export function getReplay(id: string) {
  return httpClient.get<SessionReplay>(`/sessions/${id}/replay`).then((res) => res.data);
}

/** Creates a new active session on the same persona/scenario/pressure. 402 when the plan's session limit is hit. */
export function retrySession(id: string) {
  return httpClient
    .post<{ session: PracticeSession }>(`/sessions/${id}/retry`, undefined, { timeout: 90_000 })
    .then((res) => res.data.session);
}

/** Called with the RETRY session's id. `null` until both sessions are scored. */
export function getComparison(retrySessionId: string) {
  return httpClient
    .get<{ comparison: SessionComparison | null }>(`/sessions/${retrySessionId}/comparison`)
    .then((res) => res.data.comparison);
}
