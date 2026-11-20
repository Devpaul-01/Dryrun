import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';

import * as api from '@/api/notifications';
import type { CursorPage, NotificationItem } from '@/types/api';

export const NOTIFICATIONS_KEY = ['notifications'] as const; // per user, not workspace

type Pages = InfiniteData<CursorPage<NotificationItem>>;

export function useNotifications(enabled = true) {
  return useInfiniteQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: ({ pageParam }) => api.listNotifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
    refetchInterval: 60_000,
  });
}

/** Unread count over the loaded pages (the API has no count endpoint). */
export function countUnread(data: Pages | undefined): number {
  return data?.pages.reduce((n, p) => n + p.items.filter((i) => !i.read_at).length, 0) ?? 0;
}

function patchPages(queryClient: ReturnType<typeof useQueryClient>, fn: (i: NotificationItem) => NotificationItem) {
  queryClient.setQueryData<Pages>(NOTIFICATIONS_KEY, (prev) => prev && { ...prev, pages: prev.pages.map((p) => ({ ...p, items: p.items.map(fn) })) });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onMutate: (id) => patchPages(queryClient, (i) => (i.id === id && !i.read_at ? { ...i, read_at: new Date().toISOString() } : i)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onMutate: () => patchPages(queryClient, (i) => (i.read_at ? i : { ...i, read_at: new Date().toISOString() })),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}
