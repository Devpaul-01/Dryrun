import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { registerPushToken } from '@/api/notifications';

const TOKEN_KEY = 'dryrun.push.token';

export type PushResult = { status: 'registered'; token: string } | { status: 'denied' | 'unsupported' | 'error' };

/** Expo push needs an EAS project id (app config `extra.eas.projectId`, or EXPO_PUBLIC_EAS_PROJECT_ID). */
function projectId(): string | undefined {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return fromConfig || process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined;
}

/**
 * Asks for notification permission (if needed), fetches this device's Expo
 * push token, and registers it with the backend. Safe to call repeatedly.
 * Web has no Expo push, so it reports `unsupported` instead of failing.
 */
export async function registerForPush(): Promise<PushResult> {
  if (Platform.OS === 'web') return { status: 'unsupported' };
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return { status: 'denied' };
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Default', importance: AndroidImportance.DEFAULT });
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId() ? { projectId: projectId() } : undefined);
    await registerPushToken(token);
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return { status: 'registered', token };
  } catch {
    return { status: 'error' };
  }
}

/** The token this device registered, so logout can deregister it server-side. */
export async function getStoredPushToken(): Promise<string | undefined> {
  try {
    return (await AsyncStorage.getItem(TOKEN_KEY)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function clearStoredPushToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    /* best effort */
  }
}

/** Show banners while the app is foregrounded (otherwise iOS/Android suppress them). */
export function configureForegroundNotifications() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}
