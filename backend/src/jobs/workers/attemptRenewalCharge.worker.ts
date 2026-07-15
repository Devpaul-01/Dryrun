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

// Day 1, 3, 7 of the grace period — a business-timed dunning schedule, not
// the generic exponential-backoff retry policy used elsewhere (architecture
// doc §14.2 / §11.3's note distinguishing the two).
const DUNNING_SCHEDULE_DAYS = [1, 3, 7];

export async function attemptRenewalChargeHandler(job: Job<{ subscriptionId: string; dunningAttempt?: number }>): Promise<void> {
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

    const { data: lastTx } = await supabaseAdmin()
      .from('payment_transactions')
      .select('raw_payload')
      .eq('subscription_id', sub.id)
      .eq('status', 'successful')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const cardToken = (lastTx?.raw_payload as any)?.cardToken;
    const plan = sub.plans as any;

    if (cardToken) {
      const result = await flutterwaveProvider.chargeRenewal(cardToken, plan.price_amount, plan.currency);
      if (result.success) {
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        await supabaseAdmin().from('subscriptions').update({ status: 'active', current_period_end: periodEnd.toISOString() }).eq('id', sub.id);
        await supabaseAdmin().from('payment_transactions').insert({
          workspace_id: sub.workspace_id,
          subscription_id: sub.id,
          provider_tx_ref: `renewal-${Date.now()}`,
          amount: result.amount,
          currency: result.currency,
          status: 'successful',
          raw_payload: result,
        });
        return;
      }
    }

    // Either no tokenizable card on file, or the charge failed — mark
    // past_due and continue the dunning schedule.
    await supabaseAdmin().from('subscriptions').update({ status: 'past_due' }).eq('id', sub.id);

    const { data: owner } = await supabaseAdmin().from('workspaces').select('owner_user_id').eq('id', sub.workspace_id).single();
    if (owner) {
      await notify({
        userId: owner.owner_user_id,
        channel: 'email',
        type: 'payment_failed',
        title: "We couldn't process your DryRun renewal",
        body: 'Please update your payment method.',
        emailHtml: buildPaymentFailedEmailHtml(`${env.frontendUrl}/billing`),
      });
    }

    const nextAttemptDay = DUNNING_SCHEDULE_DAYS[attempt];
    if (nextAttemptDay) {
      const delayMs = nextAttemptDay * 24 * 60 * 60 * 1000;
      await enqueue(
        'billing',
        'attempt_renewal_charge',
        { subscriptionId: sub.id, dunningAttempt: attempt + 1 },
        { delay: delayMs }
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
