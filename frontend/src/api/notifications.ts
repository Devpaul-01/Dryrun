import { httpClient } from '@/api/httpClient';
import type { CursorPage, NotificationItem } from '@/types/api';

// Verified against notifications.routes.ts. The log row's `payload` is { title, body, ...data }.

export function listNotifications(cursor?: string) {
  return httpClient.get<CursorPage<NotificationItem>>('/notifications', { params: cursor ? { cursor } : undefined }).then((res) => res.data);
}

export function markNotificationRead(id: string) {
  return httpClient.post<{ success: boolean }>(`/notifications/${id}/read`).then((res) => res.data);
}

export function markAllNotificationsRead() {
  return httpClient.post<{ success: boolean }>('/notifications/mark-all-read').then((res) => res.data);
}

/** Registers an Expo push token for this user (idempotent server-side). */
export function registerPushToken(token: string) {
  return httpClient.post<{ success: boolean }>('/notifications/push-token', { token }).then((res) => res.data);
}
