import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import * as playbooksApi from '@/api/playbooks';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Playbook } from '@/types/api';
import type { CreatePlaybookRequest } from '@/types/requests';
import { generateIdempotencyKey } from '@/utils/idempotencyKey';

export const playbooksKey = (workspaceId: string) => ['playbooks', workspaceId] as const;
export const playbookKey = (id: string) => ['playbook', id] as const;

export function usePlaybooks() {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId) ?? 'none';
  return useInfiniteQuery({
    queryKey: playbooksKey(workspaceId),
    queryFn: ({ pageParam }) => playbooksApi.listPlaybooks(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: workspaceId !== 'none',
  });
}

export function usePlaybook(id: string | undefined) {
  return useQuery({ queryKey: playbookKey(id ?? 'none'), queryFn: () => playbooksApi.getPlaybook(id as string), enabled: !!id });
}

export function usePlaybookVersions(id: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: ['playbookVersions', id ?? 'none'], queryFn: () => playbooksApi.listPlaybookVersions(id as string), enabled: !!id && enabled });
}

export function usePublicPlaybook(token: string | undefined) {
  return useQuery({
    queryKey: ['publicPlaybook', token ?? 'none'],
    queryFn: () => playbooksApi.getPublicPlaybook(token as string),
    enabled: !!token,
    retry: false, // a 404 means revoked/invalid; retrying will not change that
  });
}

function useAfterPlaybookChange() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId) ?? 'none';
  return (playbook?: Playbook) => {
    if (playbook) queryClient.setQueryData(playbookKey(playbook.id), playbook);
    void queryClient.invalidateQueries({ queryKey: playbooksKey(workspaceId) });
    if (playbook) void queryClient.invalidateQueries({ queryKey: ['playbookVersions', playbook.id] });
  };
}

/**
 * One idempotency key per user intent: the key is minted on first call and
 * reused for every automatic or manual retry of that same generation, then
 * rotated after a success so the next playbook is a distinct request.
 */
export function useCreatePlaybook() {
  const after = useAfterPlaybookChange();
  const key = useRef<string | null>(null);
  return useMutation({
    mutationFn: (body: CreatePlaybookRequest) => {
      key.current ??= generateIdempotencyKey();
      return playbooksApi.createPlaybook(body, key.current);
    },
    onSuccess: (playbook) => {
      key.current = null;
      after(playbook);
    },
  });
}

export function useRegeneratePlaybook(id: string) {
  const after = useAfterPlaybookChange();
  return useMutation({ mutationFn: () => playbooksApi.regeneratePlaybook(id), onSuccess: after });
}

export function useSharePlaybook(id: string) {
  const queryClient = useQueryClient();
  const after = useAfterPlaybookChange();
  return useMutation({
    mutationFn: (attributionEnabled: boolean) => playbooksApi.sharePlaybook(id, attributionEnabled),
    onSuccess: (token, attributionEnabled) => {
      queryClient.setQueryData<Playbook>(playbookKey(id), (old) =>
        old ? { ...old, share_token: token, share_attribution_enabled: attributionEnabled } : old,
      );
      after();
    },
  });
}

export function useRevokePlaybookShare(id: string) {
  const queryClient = useQueryClient();
  const after = useAfterPlaybookChange();
  return useMutation({
    mutationFn: () => playbooksApi.revokePlaybookShare(id),
    onSuccess: () => {
      queryClient.setQueryData<Playbook>(playbookKey(id), (old) => (old ? { ...old, share_token: null } : old));
      after();
    },
  });
}
