import { supabaseAdmin } from '../../config/supabase';
import { sendEmail } from './email.service';
import { sendPush } from './push.service';
import { createLogger } from '../../config/logger';

const log = createLogger('notifications-service');

interface NotifyInput {
  userId: string;
  channel: 'email' | 'push' | 'in_app';
  type: string;
  title: string;
  body: string;
  emailHtml?: string;
  data?: Record<string, unknown>;
}

/**
 * Every notification-worthy event, regardless of channel, gets a
 * `notifications_log` row first — this is the in-app notification center's
 * data source and the audit record of what was sent, independent of
 * whether the channel-specific delivery (email/push) actually succeeds.
 */
export async function notify(input: NotifyInput): Promise<void> {
  await supabaseAdmin().from('notifications_log').insert({
    user_id: input.userId,
    channel: input.channel,
    type: input.type,
    payload: { title: input.title, body: input.body, ...input.data },
  });

  try {
    if (input.channel === 'email' && input.emailHtml) {
      const { data: user } = await supabaseAdmin().from('users').select('email').eq('id', input.userId).single();
      if (user?.email) {
        await sendEmail({ to: user.email, subject: input.title, html: input.emailHtml });
      }
    } else if (input.channel === 'push') {
      await sendPush(input.userId, input.title, input.body, input.data);
    }
  } catch (err) {
    log.warn({ err, userId: input.userId, channel: input.channel }, 'Notification delivery failed');
  }
}

export async function listNotifications(userId: string) {
  const { data } = await supabaseAdmin()
    .from('notifications_log')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  return data ?? [];
}

export async function markRead(notificationId: string, userId: string) {
  await supabaseAdmin()
    .from('notifications_log')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId);
}

export async function markAllRead(userId: string) {
  await supabaseAdmin()
    .from('notifications_log')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
}
