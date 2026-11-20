import type { Href } from 'expo-router';

/**
 * Maps a notification (push `data` or inbox row `payload`) to the screen it
 * should open. Keyed on the backend's explicit `type` field, never on which
 * fields happen to be present (notifications.service.ts guarantees `type`).
 * Push data carries `sessionId` in camelCase for debrief_ready.
 */
export function notificationRoute(type: unknown, data: Record<string, unknown> | null | undefined): Href | null {
  switch (type) {
    case 'debrief_ready': {
      const id = data?.sessionId ?? data?.session_id;
      return typeof id === 'string' && id.length > 0 ? `/(app)/session/${id}/debrief` : null;
    }
    case 'payment_failed':
      return '/(app)/billing/subscription';
    case 'weekly_summary':
      return '/(app)/(tabs)/progress';
    default:
      return null;
  }
}

/** Title/body for an inbox row, tolerating older rows without a payload. */
export function notificationText(payload: Record<string, unknown> | null | undefined): { title: string; body: string } {
  const title = typeof payload?.title === 'string' ? payload.title : 'Notification';
  const body = typeof payload?.body === 'string' ? payload.body : '';
  return { title, body };
}
