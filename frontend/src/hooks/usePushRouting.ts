import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useNotificationPreferences } from '@/hooks/useAccount';
import { NOTIFICATIONS_KEY } from '@/hooks/useNotifications';
import { notificationRoute } from '@/utils/notificationRoute';
import { registerForPush } from '@/utils/push';

/**
 * Deep-links a tapped push to its screen: while running/backgrounded via the
 * response listener, and from a cold start via the last response. Mounted in
 * the authenticated shell so the target screen is reachable when it fires.
 */
export function usePushRouting() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const target = notificationRoute(data?.type, data);
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      if (target) router.push(target);
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    const recv = Notifications.addNotificationReceivedListener(() => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }));
    return () => {
      sub.remove();
      recv.remove();
    };
  }, [router, queryClient]);
}

/**
 * Keeps this device registered while the user has push enabled. Tokens are
 * per-device, so a user who enabled push on another phone still needs this
 * one registered the first time they sign in here.
 */
export function usePushRegistration() {
  const prefs = useNotificationPreferences();
  const enabled = prefs.data?.async_ready_push_enabled === true;
  useEffect(() => {
    if (enabled) void registerForPush();
  }, [enabled]);
}
