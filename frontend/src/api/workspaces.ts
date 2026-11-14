import { httpClient } from '@/api/httpClient';
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
