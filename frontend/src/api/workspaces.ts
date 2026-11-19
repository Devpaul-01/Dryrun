import { httpClient } from '@/api/httpClient';
import type { CursorPage, MemberListItem, TeamProgress, Workspace } from '@/types/api';
import type { ListWorkspacesResponse, SwitchWorkspaceResponse } from '@/types/auth';
import type { SwitchWorkspaceRequest } from '@/types/requests';

export function listWorkspaces() {
  return httpClient.get<ListWorkspacesResponse>('/workspaces').then((res) => res.data);
}

export function switchWorkspace(body: SwitchWorkspaceRequest) {
  return httpClient
    .post<SwitchWorkspaceResponse>('/workspaces/current/switch', body)
    .then((res) => res.data);
}

// ---- Team management (workspace.routes.ts). Reads are open to members; invite/remove/rename/team-progress
// need owner|admin; role changes and ownership transfer need owner. ----

export function getCurrentWorkspace() {
  return httpClient.get<{ workspace: Workspace }>('/workspaces/current').then((res) => res.data.workspace);
}

export function renameWorkspace(name: string) {
  return httpClient.patch<{ workspace: Workspace }>('/workspaces/current', { name }).then((res) => res.data.workspace);
}

export function listMembers(cursor?: string) {
  return httpClient
    .get<CursorPage<MemberListItem>>('/workspaces/current/members', { params: cursor ? { cursor } : undefined })
    .then((res) => res.data);
}

export function getTeamProgress() {
  return httpClient.get<{ progress: TeamProgress }>('/workspaces/current/team-progress').then((res) => res.data.progress);
}

/** The backend emails the invite link (7-day expiry); it returns only the invite id, never the token. */
export function inviteMember(email: string, role: 'admin' | 'member') {
  return httpClient.post<{ invite: { id: string } }>('/workspaces/current/invites', { email, role }).then((res) => res.data.invite);
}

export function acceptInvite(token: string) {
  return httpClient
    .post<{ success: boolean; workspaceId: string; alreadyMember: boolean }>(`/workspaces/invites/${encodeURIComponent(token)}/accept`)
    .then((res) => res.data);
}

export function removeMember(memberId: string) {
  return httpClient.delete<{ success: boolean }>(`/workspaces/current/members/${memberId}`).then((res) => res.data);
}

export function setMemberRole(memberId: string, role: 'admin' | 'member') {
  return httpClient.patch<{ success: boolean }>(`/workspaces/current/members/${memberId}/role`, { role }).then((res) => res.data);
}

/** Note: this endpoint's body key is camelCase (`newOwnerUserId`), unlike the rest of the API. */
export function transferOwnership(newOwnerUserId: string) {
  return httpClient.post<{ success: boolean }>('/workspaces/current/transfer-ownership', { newOwnerUserId }).then((res) => res.data);
}

export function leaveWorkspace() {
  return httpClient.post<{ success: boolean }>('/workspaces/current/leave').then((res) => res.data);
}
