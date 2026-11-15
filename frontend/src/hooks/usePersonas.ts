import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import * as personasApi from '@/api/personas';
import * as uploadsApi from '@/api/uploads';
import { supabase } from '@/lib/supabaseClient';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Persona } from '@/types/api';
import type {
  CreatePersonaFromSourceRequest,
  CreatePersonaRequest,
  UpdatePersonaRequest,
} from '@/types/requests';

/** Generation-status fallback poll interval (architecture doc §4.4). */
export const PERSONA_POLL_MS = 3000;
/** Name the backend gives a persona that is still being synthesised. */
export const GENERATING_NAME = 'Generating…';

export const personasKey = (workspaceId: string) => ['personas', workspaceId] as const;
export const personaKey = (personaId: string) => ['persona', personaId] as const;

export function useScenarioCatalog() {
  return useQuery({
    queryKey: ['scenarios'],
    queryFn: () => personasApi.getScenarios(),
    staleTime: Infinity, // static catalog
  });
}

/** GET /personas, cursor-paginated. */
export function usePersonas() {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  return useInfiniteQuery({
    queryKey: personasKey(workspaceId ?? 'none'),
    queryFn: ({ pageParam }) => personasApi.listPersonas(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!workspaceId,
  });
}

/**
 * GET /personas/:id with generation tracking (§4.4). While the persona is
 * `generating` it polls every 3s AND listens on the Supabase broadcast
 * channel `persona:{id}`. The realtime payload shape isn't specified by the
 * backend, so any message just triggers a refetch rather than being trusted.
 * Both stop as soon as the status leaves `generating`, at which point the
 * list is refreshed so the library shows the finished persona.
 */
export function usePersona(personaId: string | undefined) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const query = useQuery({
    queryKey: personaKey(personaId ?? 'none'),
    queryFn: () => personasApi.getPersona(personaId as string),
    enabled: !!personaId,
    refetchInterval: (q) => (q.state.data?.generation_status === 'generating' ? PERSONA_POLL_MS : false),
  });

  const status = query.data?.generation_status;
  const refetch = query.refetch;

  useEffect(() => {
    if (!personaId || status !== 'generating' || !supabase) return;
    const channel = supabase
      .channel(`persona:${personaId}`)
      .on('broadcast', { event: '*' }, () => {
        void refetch();
      })
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [personaId, status, refetch]);

  useEffect(() => {
    if (status && status !== 'generating' && workspaceId) {
      void queryClient.invalidateQueries({ queryKey: personasKey(workspaceId) });
    }
  }, [status, workspaceId, queryClient]);

  return query;
}

function useInvalidatePersonas() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  return () => queryClient.invalidateQueries({ queryKey: personasKey(workspaceId ?? 'none') });
}

export function useCreatePersona() {
  const invalidate = useInvalidatePersonas();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePersonaRequest) => personasApi.createPersona(body),
    onSuccess: (persona: Persona) => {
      queryClient.setQueryData(personaKey(persona.id), persona);
      void invalidate();
    },
  });
}

export function useCreatePersonaFromSource() {
  const invalidate = useInvalidatePersonas();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePersonaFromSourceRequest) => personasApi.createPersonaFromSource(body),
    onSuccess: (persona: Persona) => {
      queryClient.setQueryData(personaKey(persona.id), persona);
      void invalidate();
    },
  });
}

export function useUpdatePersona(personaId: string) {
  const invalidate = useInvalidatePersonas();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePersonaRequest) => personasApi.updatePersona(personaId, body),
    onSuccess: (persona: Persona) => {
      queryClient.setQueryData(personaKey(personaId), persona);
      void invalidate();
    },
  });
}

export function useDeletePersona() {
  const invalidate = useInvalidatePersonas();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (personaId: string) => personasApi.deletePersona(personaId),
    onSuccess: (_data, personaId) => {
      queryClient.removeQueries({ queryKey: personaKey(personaId) });
      void invalidate();
    },
  });
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

/** signed-url → PUT bytes → complete, resolving to the upload_id for `from-source` (§2.9). */
export function useUploadPersonaSource() {
  return useMutation({
    mutationFn: async (file: PickedFile) => {
      const signed = await uploadsApi.createSignedUpload({
        purpose: 'persona_source',
        filename: file.name,
        mime_type: file.mimeType,
        size_bytes: file.size,
      });
      const blob = await (await fetch(file.uri)).blob();
      await uploadsApi.putToSignedUrl(signed.signed_url, blob, file.mimeType);
      await uploadsApi.completeUpload(signed.upload_id);
      return signed.upload_id;
    },
  });
}
