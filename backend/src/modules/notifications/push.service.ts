import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { env } from '../../config/env';
import { supabaseAdmin } from '../../config/supabase';
import { createLogger } from '../../config/logger';

const log = createLogger('push-service');
const expo = new Expo({ accessToken: env.expoAccessToken || undefined });

export async function registerPushToken(userId: string, token: string): Promise<void> {
  if (!Expo.isExpoPushToken(token)) {
    log.warn({ userId }, 'Attempted to register an invalid Expo push token');
    return;
  }
  await supabaseAdmin().from('push_tokens').upsert({ user_id: userId, token, updated_at: new Date().toISOString() }, { onConflict: 'user_id,token' });
}

/**
 * Sends a push to every registered token for a user. Invalid/expired
 * tokens (Expo returns a DeviceNotRegistered error) are marked stale and
 * removed — never retried indefinitely against a dead token.
 */
export async function sendPush(userId: string, title: string, body: string, data: Record<string, unknown> = {}): Promise<void> {
  const { data: tokens } = await supabaseAdmin().from('push_tokens').select('token').eq('user_id', userId);
  if (!tokens || tokens.length === 0) return;

  const messages: ExpoPushMessage[] = tokens
    .filter((t) => Expo.isExpoPushToken(t.token))
    .map((t) => ({ to: t.token, sound: 'default', title, body, data }));

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      for (let i = 0; i < receipts.length; i++) {
        if (receipts[i].status === 'error' && (receipts[i] as any).details?.error === 'DeviceNotRegistered') {
          await supabaseAdmin().from('push_tokens').delete().eq('token', chunk[i].to as string);
        }
      }
    } catch (err) {
      log.warn({ err }, 'Failed to send push notification chunk');
    }
  }
}
