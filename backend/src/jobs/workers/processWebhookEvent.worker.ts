import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { flutterwaveProvider } from '../../modules/billing/providers/flutterwave.provider';
import { enqueue } from '../queues';
import { createLogger } from '../../config/logger';

const log = createLogger('process-webhook-event-worker');

export async function processWebhookEventHandler(job: Job<{ webhookEventId: string }>): Promise<void> {
  const { data: event } = await supabaseAdmin().from('webhook_events').select('*').eq('id', job.data.webhookEventId).single();
  if (!event || event.processed) return;

  const payload = event.payload as any;
  const txRef = payload?.data?.tx_ref;
  if (!txRef) {
    log.warn({ eventId: event.id }, 'Webhook payload missing tx_ref — nothing to reconcile');
    await supabaseAdmin().from('webhook_events').update({ processed: true, processed_at: new Date().toISOString() }).eq('id', event.id);
    return;
  }

  // Never trust the webhook payload alone as proof of a successful charge —
  // always re-verify against the provider directly.
  const verification = await flutterwaveProvider.verifyTransaction(txRef);

  const { data: subscription } = await supabaseAdmin()
    .from('subscriptions')
    .select('id, workspace_id')
    .eq('provider', 'flutterwave')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (verification.success && subscription) {
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await supabaseAdmin()
      .from('subscriptions')
      .update({ status: 'active', current_period_end: periodEnd.toISOString() })
      .eq('id', subscription.id);

    await supabaseAdmin().from('payment_transactions').insert({
      workspace_id: subscription.workspace_id,
      subscription_id: subscription.id,
      provider_tx_ref: txRef,
      amount: verification.amount,
      currency: verification.currency,
      status: 'successful',
      raw_payload: payload,
    });

    await supabaseAdmin().from('audit_log').insert({
      workspace_id: subscription.workspace_id,
      action: 'webhook_payment_confirmed',
      target_type: 'subscription',
      target_id: subscription.id,
      metadata: { txRef },
    });
  } else if (subscription) {
    await enqueue('notifications', 'send_payment_failed_email', { workspaceId: subscription.workspace_id });
  }

  await supabaseAdmin().from('webhook_events').update({ processed: true, processed_at: new Date().toISOString() }).eq('id', event.id);
}
