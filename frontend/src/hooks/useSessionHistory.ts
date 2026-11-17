import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import * as sessionsApi from '@/api/sessions';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { CursorPage, SessionListItem } from '@/types/api';
import type { ListSessionsRequest } from '@/types/requests';

export type HistoryFilters = Omit<ListSessionsRequest, 'cursor' | 'limit'>;

export const historyKey = (workspaceId: string, filters?: HistoryFilters) =>
  filters ? (['sessions', workspaceId, filters] as const) : (['sessions', workspaceId] as const);

/** GET /sessions with the filter UI mapped 1:1 to query params (§7.11). */
export function useSessionHistory(filters: HistoryFilters) {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId) ?? 'none';
  return useInfiniteQuery({
    queryKey: historyKey(workspaceId, filters),
    queryFn: ({ pageParam }) => sessionsApi.listSessions({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: workspaceId !== 'none',
  });
}

type Pages = { pages: CursorPage<SessionListItem>[]; pageParams: unknown[] };

/** Applies `fn` to every cached history list so a row action is reflected in every filter combination at once. */
function patchAllLists(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string, fn: (items: SessionListItem[]) => SessionListItem[]) {
  queryClient.setQueriesData<Pages>({ queryKey: historyKey(workspaceId) }, (old) =>
    old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: fn(p.items) })) } : old,
  );
}

function useRowMutation<V>(
  mutationFn: (v: V) => Promise<unknown>,
  optimistic: (items: SessionListItem[], v: V) => SessionListItem[],
) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId) ?? 'none';
  return useMutation({
    mutationFn,
    onMutate: async (v: V) => {
      await queryClient.cancelQueries({ queryKey: historyKey(workspaceId) });
      const snapshot = queryClient.getQueriesData<Pages>({ queryKey: historyKey(workspaceId) });
      patchAllLists(queryClient, workspaceId, (items) => optimistic(items, v));
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: historyKey(workspaceId) }),
  });
}

export const useRenameSession = () =>
  useRowMutation(
    (v: { id: string; title: string }) => sessionsApi.renameSession(v.id, v.title),
    (items, v) => items.map((i) => (i.id === v.id ? { ...i, title: v.title } : i)),
  );

/** Archive/unarchive move a row between the active and archived lists, so it is removed from the current view immediately. */
export const useArchiveSession = () =>
  useRowMutation(
    (v: { id: string; archive: boolean }) => (v.archive ? sessionsApi.archiveSession(v.id) : sessionsApi.unarchiveSession(v.id)),
    (items, v) => items.filter((i) => i.id !== v.id),
  );

export const useDeleteSession = () =>
  useRowMutation(
    (id: string) => sessionsApi.deleteSession(id),
    (items, id) => items.filter((i) => i.id !== id),
  );
