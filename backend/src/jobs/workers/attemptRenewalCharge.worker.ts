import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { redisConnection } from '../../config/redis';
import { flutterwaveProvider } from '../../modules/billing/providers/flutterwave.provider';
import { enqueue } from '../queues';
import { notify } from '../../modules/notifications/notifications.service';
import { buildPaymentFailedEmailHtml } from '../../modules/notifications/email.service';
import { env } from '../../config/env';
import { createLogger } from '../../config/logger';

const log = createLogger('renewal-charge-worker');

// FIX (HIGH-10): these are now ABSOLUTE days-since-the-first-failure
// (captured once, at the first failed attempt, and threaded through
// every subsequent retry's job payload as `firstFailedAt`), not
// compounding delays from the previous attempt. The old cumulative math
// (each delay computed from `Date.now()` at dispatch time, not from the
// original failure) landed retries around day 0, 1, 4, 11 despite this
// constant's own name implying day 1, 3, 7 — and final cancellation at
// ~day 11 happened AFTER entitlements.ts's 10-day PAST_DUE_GRACE_DAYS
// window had already silently downgraded the workspace to the free
// plan for about a day, even though dunning was still actively retrying.
// [1, 4, 8] below is chosen so the final attempt — and, on its failure,
// cancellation — lands at or before day 10, matching that grace window
// exactly. See entitlements.ts's PAST_DUE_GRACE_DAYS.
const DUNNING_SCHEDULE_DAYS = [1, 4, 8];

export async function attemptRenewalChargeHandler(
  job: Job<{ subscriptionId: string; dunningAttempt?: number; firstFailedAt?: string }>
): Promise<void> {
  const attempt = job.data.dunningAttempt ?? 0;

  // Narrow distributed lock: prevents a double-charge if a scheduler tick
  // and a manual admin retry overlap for the same subscription.
  const redis = redisConnection();
  const lockKey = `renewal-lock:${job.data.subscriptionId}`;
  const acquired = await redis.set(lockKey, '1', 'PX', 30000, 'NX');
  if (!acquired) {
    log.info({ subscriptionId: job.data.subscriptionId }, 'Renewal already in progress, skipping duplicate attempt');
    return;
  }

  try {
    const { data: sub } = await supabaseAdmin()
      .from('subscriptions')
      .select('id, workspace_id, plan_id, plans(price_amount, currency)')
      .eq('id', job.data.subscriptionId)
      .single();
    if (!sub) return;

    // FIX (MED-4): resolve the workspace owner's email up front. Needed
    // both for the tokenized renewal charge itself (Flutterwave's
    // tokenized-charge endpoint requires a real customer email — this
    // used to be hardcoded to 'billing@dryrun.app' regardless of who was
    // actually being charged, inconsistent with initiateCharge's use of
    // the real customer email) and for the payment-failed notification
    // below, which already needed owner_user_id.
    const { data: workspace } = await supabaseAdmin().from('workspaces').select('owner_user_id').eq('id', sub.workspace_id).single();
    const ownerUserId = workspace?.owner_user_id ?? null;
    const { data: ownerProfile } = ownerUserId
      ? await supabaseAdmin().from('users').select('email').eq('id', ownerUserId).maybeSingle()
      : { data: null as { email: string } | null };

    const { data: lastTx } = await supabaseAdmin()
      .from('payment_transactions')
      .select('card_token')
      .eq('subscription_id', sub.id)
      .eq('status', 'successful')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // FIX (CRIT-3): read the dedicated card_token column instead of
    // reaching into raw_payload, which was populated inconsistently
    // depending on whether confirmCheckout or the webhook-reconciliation
    // path recorded the first successful payment (see
    // db/migrations/0005 and billing.service.ts's confirmCheckout).
    const cardToken = lastTx?.card_token;
    const plan = sub.plans as any;

    if (cardToken && ownerProfile?.email) {
      const result = await flutterwaveProvider.chargeRenewal(cardToken, plan.price_amount, plan.currency, ownerProfile.email);
      if (result.success) {
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        // FIX (MED-5): atomic reconciliation, same function and rationale
        // as billing.service.ts's confirmCheckout and
        // processWebhookEvent.worker.ts.
        const { error: rpcError } = await supabaseAdmin().rpc('reconcile_successful_payment', {
          p_subscription_id: sub.id,
          p_workspace_id: sub.workspace_id,
          p_provider_tx_ref: `renewal-${Date.now()}`,
          p_amount: result.amount,
          p_currency: result.currency,
          p_card_token: result.cardToken ?? cardToken,
          p_provider_tx_id: result.providerTxId ?? null,
          p_raw_payload: result,
          p_new_status: 'active',
          p_new_period_start: null,
          p_new_period_end: periodEnd.toISOString(),
          p_clear_pending_tx_ref: false,
          p_audit_action: 'subscription_renewed',
          p_audit_actor_user_id: null,
          p_audit_metadata: { amount: result.amount, currency: result.currency, dunningAttempt: attempt },
        });
        if (rpcError) {
          log.error({ err: rpcError, subscriptionId: sub.id }, 'ALERT: renewal charge succeeded at the provider but failed to reconcile locally');
          throw rpcError; // surfaces as a dead-lettered, alerted failure — the charge happened, this must not be silently lost
        }
        return;
      }
    }

    // Either no tokenizable card on file, no resolvable owner email, or
    // the charge failed — mark past_due and continue the dunning schedule.
    await supabaseAdmin().from('subscriptions').update({ status: 'past_due' }).eq('id', sub.id);

    if (ownerUserId) {
      await notify({
        userId: ownerUserId,
        channel: 'email',
        type: 'payment_failed',
        title: "We couldn't process your DryRun renewal",
        body: 'Please update your payment method.',
        emailHtml: buildPaymentFailedEmailHtml(`${env.frontendUrl}/billing`),
      });
    }

    // FIX (HIGH-10): firstFailedAt is captured once, on this (the first)
    // failure, and threaded through every subsequent retry's payload so
    // each delay below is computed as an absolute offset from the
    // ORIGINAL failure rather than compounding from whenever the
    // previous attempt happened to run.
    const firstFailedAt = job.data.firstFailedAt ?? new Date().toISOString();

    const nextAttemptDay = DUNNING_SCHEDULE_DAYS[attempt];
    if (nextAttemptDay) {
      const delayMs = new Date(firstFailedAt).getTime() + nextAttemptDay * 24 * 60 * 60 * 1000 - Date.now();
      await enqueue(
        'billing',
        'attempt_renewal_charge',
        { subscriptionId: sub.id, dunningAttempt: attempt + 1, firstFailedAt },
        { delay: Math.max(0, delayMs) }
      );
    } else {
      await supabaseAdmin().from('subscriptions').update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('id', sub.id);
      await supabaseAdmin().from('audit_log').insert({
        workspace_id: sub.workspace_id,
        action: 'subscription_canceled_dunning_exhausted',
        target_type: 'subscription',
        target_id: sub.id,
        metadata: {},
      });
    }
  } finally {
    await redis.del(lockKey);
  }
}
