import { httpClient } from '@/api/httpClient';
import type { PersonaSnapshot } from '@/types/api';

// Public endpoints (demo.routes.ts) — no auth. The demo token is the only credential.

export type DemoCategory = 'saas' | 'services' | 'physical_product';

export interface DemoPersona extends Partial<PersonaSnapshot> {
  name: string;
  role: string;
}

export interface DemoMessage {
  role: 'user' | 'buyer';
  content: string;
}

export function startDemo(fingerprint: string, category: DemoCategory) {
  return httpClient
    .post<{ token: string; persona: DemoPersona; scenario_type: string }>('/demo/start', { fingerprint, category })
    .then((res) => res.data);
}

/** `messages_remaining` counts down from 8; a 403 means the cap was already hit. */
export function sendDemoMessage(token: string, content: string) {
  return httpClient
    .post<{ reply: string; messages_remaining: number }>(`/demo/${encodeURIComponent(token)}/messages`, { content })
    .then((res) => res.data);
}

export function endDemo(token: string) {
  return httpClient.post<{ success: boolean }>(`/demo/${encodeURIComponent(token)}/end`).then((res) => res.data);
}

export function getDemoReplay(token: string) {
  return httpClient.get<{ messages: DemoMessage[]; persona: DemoPersona }>(`/demo/${encodeURIComponent(token)}/replay`).then((res) => res.data);
}

/**
 * Creates the real account and copies the demo into it as a completed
 * session. It does NOT sign the user in: the account must be email-verified
 * first, so the app keeps `sessionId` to open after their first login.
 */
export function convertDemo(token: string, email: string, password: string) {
  return httpClient
    .post<{ userId: string; workspaceId: string; sessionId: string; message: string }>(`/demo/${encodeURIComponent(token)}/convert`, { email, password })
    .then((res) => res.data);
}
