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

    // FIX (MED-5): atomic reconciliation via the same Postgres function
    // confirmCheckout uses — see billing.service.ts's confirmCheckout and
    // db/migrations/0005 for the full rationale. This is the OTHER path
    // that can record a subscription's first successful payment, so it
    // needs the identical fix.
    //
    // FIX (CRIT-3): raw_payload keeps storing the raw webhook body (still
    // useful for debugging) but card_token/provider_tx_id are now also
    // written to their own dedicated columns, pulled from `verification`
    // (the re-verified result from the provider) rather than left absent
    // the way this path used to leave them.
    const { error: rpcError } = await supabaseAdmin().rpc('reconcile_successful_payment', {
      p_subscription_id: subscription.id,
      p_workspace_id: subscription.workspace_id,
      p_provider_tx_ref: txRef,
      p_amount: verification.amount,
      p_currency: verification.currency,
      p_card_token: verification.cardToken ?? null,
      p_provider_tx_id: verification.providerTxId ?? null,
      p_raw_payload: payload,
      p_new_status: 'active',
      p_new_period_start: new Date().toISOString(),
      p_new_period_end: periodEnd.toISOString(),
      p_clear_pending_tx_ref: true,
      p_audit_action: 'webhook_payment_confirmed',
      p_audit_actor_user_id: null,
      p_audit_metadata: { txRef },
    });
    if (rpcError) {
      log.error({ err: rpcError, eventId: event.id, subscriptionId: subscription.id }, 'ALERT: webhook-verified payment failed to reconcile locally');
      throw rpcError; // surfaces as a dead-lettered, alerted failure and lets BullMQ retry — do NOT mark this event processed
    }
  } else {
    await enqueue('notifications', 'send_payment_failed_email', { workspaceId: subscription.workspace_id });
  }

  await supabaseAdmin().from('webhook_events').update({ processed: true, processed_at: new Date().toISOString() }).eq('id', event.id);
}
