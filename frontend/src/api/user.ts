import { httpClient } from '@/api/httpClient';
import type { User } from '@/types/api';

// Verified against backend profile / notificationPreferences / export routes (all mounted under /user).

export interface NotificationPreferences {
  weekly_summary_enabled: boolean;
  async_ready_push_enabled: boolean;
}

export function updateProfile(displayName: string) {
  return httpClient.patch<{ user: User }>('/user/me', { display_name: displayName }).then((res) => res.data.user);
}

/** Soft-deletes (14-day grace). 409 while you own a workspace that still has other active members. */
export function deleteAccount() {
  return httpClient.delete<{ success?: boolean }>('/user/me').then((res) => res.data);
}

export function getNotificationPreferences() {
  return httpClient.get<{ preferences: NotificationPreferences }>('/user/notification-preferences').then((res) => res.data.preferences);
}

export function updateNotificationPreferences(patch: Partial<NotificationPreferences>) {
  return httpClient.patch<{ preferences: NotificationPreferences }>('/user/notification-preferences', patch).then((res) => res.data.preferences);
}

/** Queues an export job (202); the result is delivered later as a notification. Rate limited. */
export function requestDataExport() {
  return httpClient.get<{ job_id: string; message: string }>('/user/export').then((res) => res.data);
}
