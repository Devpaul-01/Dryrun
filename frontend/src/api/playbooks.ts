import { httpClient } from '@/api/httpClient';
import type { CursorPage, Playbook, PlaybookListItem, PlaybookVersion, PublicPlaybook } from '@/types/api';
import type { CreatePlaybookRequest } from '@/types/requests';

interface RawPlaybook extends Omit<Playbook, 'current_version'> {
  playbook_versions: PlaybookVersion | PlaybookVersion[];
}

/** Collapses the backend's embedded join (object, or single-element array depending on the relation) into `current_version`. */
function normalise<T extends { playbook_versions: PlaybookVersion | PlaybookVersion[] }>(raw: T) {
  const { playbook_versions, ...rest } = raw;
  const current_version = Array.isArray(playbook_versions) ? playbook_versions[0] : playbook_versions;
  return { ...rest, current_version };
}

const AI_TIMEOUT_MS = 90_000;

export function listPlaybooks(cursor?: string) {
  return httpClient
    .get<CursorPage<PlaybookListItem>>('/playbooks', { params: cursor ? { cursor } : undefined })
    .then((res) => res.data);
}

export function getPlaybook(id: string): Promise<Playbook> {
  return httpClient.get<{ playbook: RawPlaybook }>(`/playbooks/${id}`).then((res) => normalise(res.data.playbook));
}

export function listPlaybookVersions(id: string) {
  return httpClient.get<{ versions: PlaybookVersion[] }>(`/playbooks/${id}/versions`).then((res) => res.data.versions);
}

/** Idempotent (the Idempotency-Key header), so a timed-out retry cannot create a second playbook. */
export function createPlaybook(body: CreatePlaybookRequest, idempotencyKey: string): Promise<Playbook> {
  return httpClient
    .post<{ playbook: RawPlaybook }>('/playbooks', body, { headers: { 'Idempotency-Key': idempotencyKey }, timeout: AI_TIMEOUT_MS })
    .then((res) => normalise(res.data.playbook));
}

export function regeneratePlaybook(id: string): Promise<Playbook> {
  return httpClient
    .post<{ playbook: RawPlaybook }>(`/playbooks/${id}/regenerate`, undefined, { timeout: AI_TIMEOUT_MS })
    .then((res) => normalise(res.data.playbook));
}

export function sharePlaybook(id: string, attributionEnabled: boolean) {
  return httpClient
    .post<{ share_token: string }>(`/playbooks/${id}/share`, { attribution_enabled: attributionEnabled })
    .then((res) => res.data.share_token);
}

export function revokePlaybookShare(id: string) {
  return httpClient.delete<{ success: boolean }>(`/playbooks/${id}/share`).then((res) => res.data);
}

export function getPublicPlaybook(token: string): Promise<PublicPlaybook> {
  return httpClient
    .get<{ playbook: { title: string; share_attribution_enabled: boolean; playbook_versions: PlaybookVersion | PlaybookVersion[] } }>(
      `/public/playbooks/${encodeURIComponent(token)}`,
    )
    .then((res) => normalise(res.data.playbook));
}
