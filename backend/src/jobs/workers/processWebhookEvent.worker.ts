import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { flutterwaveProvider } from '../../modules/billing/providers/flutterwave.provider';
import { enqueue } from '../queues';
import { createLogger } from '../../config/logger';

const log = createLogger('process-webhook-event-worker');

/**
 * SECURITY/INTEGRITY FIX — the most severe finding surfaced by this
 * review: this handler used to match "the most recent subscription row
 * across the ENTIRE flutterwave provider," with NO workspace filter and
 * NO tie to the actual transaction reference the webhook was about. In
 * any deployment with more than one workspace, a genuine successful-
 * payment webhook for workspace A could activate workspace B's pending
 * subscription instead (whichever happened to be most recently created,
 * regardless of which workspace the payment was actually for), and the
 * failure branch could send a "payment failed" email to the wrong
 * workspace's owner. This is a real cross-tenant billing-state
 * misattribution bug reachable by ordinary external payment-provider
 * traffic, not just an internal edge case.
 *
 * Fixed the same way as billing.service.ts's confirmCheckout: match by
 * the exact pending_tx_ref that initiateCheckout stored on the
 * subscription row at checkout-creation time, instead of guessing via
 * recency with no workspace scoping at all.
 */
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
    .eq('pending_tx_ref', txRef)
    .maybeSingle();

  if (!subscription) {
    log.warn({ eventId: event.id, txRef }, 'No pending subscription found matching this transaction reference — nothing to reconcile');
    await supabaseAdmin().from('webhook_events').update({ processed: true, processed_at: new Date().toISOString() }).eq('id', event.id);
    return;
  }

  if (verification.success) {
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await supabaseAdmin()
      .from('subscriptions')
      .update({ status: 'active', current_period_end: periodEnd.toISOString(), pending_tx_ref: null })
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
  } else {
    await enqueue('notifications', 'send_payment_failed_email', { workspaceId: subscription.workspace_id });
  }

  await supabaseAdmin().from('webhook_events').update({ processed: true, processed_at: new Date().toISOString() }).eq('id', event.id);
}
