import { httpClient } from '@/api/httpClient';
import type { CursorPage, Persona, PersonaListItem, ScenarioCatalog } from '@/types/api';
import type {
  CreatePersonaFromSourceRequest,
  CreatePersonaRequest,
  UpdatePersonaRequest,
} from '@/types/requests';
import type { SuccessMessageResponse } from '@/types/auth';

export function getScenarios() {
  return httpClient.get<ScenarioCatalog>('/scenarios').then((res) => res.data);
}

export function listPersonas(cursor?: string) {
  return httpClient
    .get<CursorPage<PersonaListItem>>('/personas', { params: cursor ? { cursor } : undefined })
    .then((res) => res.data);
}

export function getPersona(id: string) {
  return httpClient.get<{ persona: Persona }>(`/personas/${id}`).then((res) => res.data.persona);
}

export function createPersona(body: CreatePersonaRequest) {
  return httpClient.post<{ persona: Persona }>('/personas', body).then((res) => res.data.persona);
}

/** 202: the returned persona is a 'Generating…' placeholder; completion arrives via realtime/polling. */
export function createPersonaFromSource(body: CreatePersonaFromSourceRequest) {
  return httpClient
    .post<{ persona: Persona; message: string }>('/personas/from-source', body)
    .then((res) => res.data.persona);
}

export function updatePersona(id: string, body: UpdatePersonaRequest) {
  return httpClient.patch<{ persona: Persona }>(`/personas/${id}`, body).then((res) => res.data.persona);
}

export function deletePersona(id: string) {
  return httpClient.delete<SuccessMessageResponse>(`/personas/${id}`).then((res) => res.data);
}
