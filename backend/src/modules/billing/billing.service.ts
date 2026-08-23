import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { flutterwaveProvider } from './providers/flutterwave.provider';
import { PaymentProvider } from './paymentProvider.interface';
import { env } from '../../config/env';
import { trackEvent } from '../analytics/analytics.service';
import { createLogger } from '../../config/logger';

const log = createLogger('billing-service');

const providers: Record<string, PaymentProvider> = { flutterwave: flutterwaveProvider };
function getProvider(name = 'flutterwave'): PaymentProvider {
  return providers[name];
}

export async function listPlans() {
  const { data } = await supabaseAdmin().from('plans').select('*').eq('is_active', true).order('price_amount', { ascending: true });
  return data ?? [];
}

export async function getCurrentSubscription(workspaceId: string) {
  const { data } = await supabaseAdmin()
    .from('subscriptions')
    .select('*, plans(*)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function initiateCheckout(workspaceId: string, planKey: string, userEmail: string) {
  const { data: plan } = await supabaseAdmin().from('plans').select('*').eq('key', planKey).single();
  if (!plan) throw ApiError.notFound('Plan not found.');

  const provider = getProvider();
  const customer = await provider.createCustomer(userEmail, userEmail);
  const checkout = await provider.initiateCharge({
    customerRef: customer,
    amount: plan.price_amount,
    currency: plan.currency,
    planKey: plan.key,
    redirectUrl: `${env.frontendUrl}/billing/callback`,
  });

  // FIX (audit finding C2): pending_tx_ref is now set at insert time, using
  // the exact provider transaction reference initiateCharge() generated
  // (flutterwave.provider.ts's initiateCharge builds this as
  // `dryrun-${planKey}-${Date.now()}`). This is what lets confirmCheckout
  // below match a verified transaction back to the EXACT pending
  // subscription row it belongs to — see that function's own comment and
  // db/schema.sql's uq_subscriptions_pending_tx_ref partial unique index,
  // which already existed for this purpose but was never populated by this
  // insert until now.
  await supabaseAdmin().from('subscriptions').insert({
    workspace_id: workspaceId,
    plan_id: plan.id,
    provider: provider.name,
    provider_customer_id: customer.providerCustomerId,
    status: 'incomplete',
    pending_tx_ref: checkout.providerTxRef,
  });

  return checkout;
}

export async function confirmCheckout(workspaceId: string, providerTxRef: string) {
  const provider = getProvider();
  const result = await provider.verifyTransaction(providerTxRef);
  if (!result.success) throw ApiError.badRequest('Payment could not be verified.');

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  // FIX (audit finding C2): this used to match "the most recent incomplete
  // subscription for this workspace" — a real race condition if a
  // workspace ever has more than one incomplete checkout attempt in
  // flight at once (a double-clicked "Upgrade" button, or a retried
  // checkout after an abandoned first attempt, both realistic on a mobile
  // client). Confirming the OLDER providerTxRef could activate whichever
  // subscription row happened to be most recently created, not the one
  // actually being confirmed. Fixed by matching on the exact
  // pending_tx_ref set at checkout-creation time above, the same fix
  // already correctly applied to processWebhookEvent.worker.ts's
  // reconciliation path — workspace_id and status are kept as additional
  // guards, not the primary match.
  const { data: sub } = await supabaseAdmin()
    .from('subscriptions')
    .select('id, plan_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'incomplete')
    .eq('pending_tx_ref', providerTxRef)
    .maybeSingle();

  if (!sub) throw ApiError.notFound('No pending checkout found for this workspace.');

  // FIX (MED-5): subscription activation, the payment_transactions
  // record, and the audit_log entry are now written atomically via a
  // single Postgres function (db/migrations/0005) instead of three
  // separate REST calls. A crash between them used to be able to leave
  // the subscription activated while permanently losing the payment
  // record, since a retry's lookup-by-pending_tx_ref would no longer
  // match once the first call had already cleared it.
  //
  // FIX (CRIT-3): card_token/provider_tx_id are now written to their own
  // dedicated columns (see migration 0005) rather than only inside
  // raw_payload, which the webhook-reconciliation path
  // (processWebhookEvent.worker.ts) stores in a different shape —
  // attemptRenewalCharge.worker.ts needs card_token to be reliably
  // present regardless of which of the two paths recorded this payment.
  const { error: rpcError } = await supabaseAdmin().rpc('reconcile_successful_payment', {
    p_subscription_id: sub.id,
    p_workspace_id: workspaceId,
    p_provider_tx_ref: providerTxRef,
    p_amount: result.amount,
    p_currency: result.currency,
    p_card_token: result.cardToken ?? null,
    p_provider_tx_id: result.providerTxId ?? null,
    p_raw_payload: result,
    p_new_status: 'active',
    p_new_period_start: now.toISOString(),
    p_new_period_end: periodEnd.toISOString(),
    p_clear_pending_tx_ref: true,
    p_audit_action: 'subscription_activated',
    p_audit_actor_user_id: null,
    p_audit_metadata: { providerTxRef },
  });
  if (rpcError) {
    log.error({ err: rpcError, workspaceId, subscriptionId: sub.id }, 'ALERT: payment verified by provider but failed to reconcile locally');
    throw ApiError.internal('Payment was verified but activation failed. Please contact support.');
  }

  await trackEvent('subscription_started', { workspaceId }, { planId: sub.plan_id });
  return { success: true };
}

export async function cancelSubscription(workspaceId: string) {
  const sub = await getCurrentSubscription(workspaceId);
  if (!sub) throw ApiError.notFound('No active subscription found.');

  // Effective at period end — never immediate, to avoid "I paid for the
  // month, why did access end today" support load.
  await supabaseAdmin()
    .from('subscriptions')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', sub.id);

  await trackEvent('subscription_canceled', { workspaceId }, {});
  return { effective_at: sub.current_period_end };
}

/**
 * FIX (MED-1): no way previously existed to undo a cancellation before
 * the period actually ends — cancelSubscription() sets canceled_at but
 * leaves status 'active' by design (see that function's own comment), so
 * undoing it is simply clearing canceled_at back to null on the same
 * row. 400s if there's no active, pending-cancellation subscription to
 * reactivate, rather than silently no-op'ing.
 */
export async function reactivateSubscription(workspaceId: string) {
  const sub = await getCurrentSubscription(workspaceId);
  if (!sub || sub.status !== 'active' || !sub.canceled_at) {
    throw ApiError.badRequest('There is no pending cancellation to undo.');
  }

  await supabaseAdmin().from('subscriptions').update({ canceled_at: null }).eq('id', sub.id);
  await trackEvent('subscription_reactivated', { workspaceId }, {});
  return { success: true };
}

/**
 * FIX (CRIT-2 / MED-2): the only previously-existing way to "change
 * plans" was calling POST /billing/checkout again, which always creates
 * a brand-new subscription row — if a workspace already had an active
 * subscription, this could leave two simultaneously-'active' rows for
 * the same workspace (the old one never canceled or superseded), each
 * independently eligible to be picked up and charged by
 * checkRenewalsDue(). This updates plan_id on the EXISTING active row
 * in place instead: no proration, no new subscription row, no risk of
 * the double-active-row state db/migrations/0006's unique index now
 * also guards against at the database level. current_period_end is left
 * untouched — the new plan's entitlements take effect immediately (see
 * entitlements.ts's resolveEffectivePlan, which reads plan_id fresh),
 * while the new price only applies starting at the next renewal charge.
 */
export async function changePlan(workspaceId: string, planKey: string, actorUserId: string) {
  const sub = await getCurrentSubscription(workspaceId);
  if (!sub || sub.status !== 'active') {
    throw ApiError.badRequest('This workspace has no active subscription to change. Use checkout to start one.');
  }

  const { data: plan } = await supabaseAdmin().from('plans').select('*').eq('key', planKey).eq('is_active', true).single();
  if (!plan) throw ApiError.notFound('Plan not found.');

  if (plan.id === sub.plan_id) {
    throw ApiError.badRequest('This workspace is already on this plan.');
  }

  const { error } = await supabaseAdmin().from('subscriptions').update({ plan_id: plan.id }).eq('id', sub.id);
  if (error) throw ApiError.internal('Failed to change plan.');

  await supabaseAdmin().from('audit_log').insert({
    actor_user_id: actorUserId,
    workspace_id: workspaceId,
    action: 'plan_changed',
    target_type: 'subscription',
    target_id: sub.id,
    metadata: { fromPlanId: sub.plan_id, toPlanId: plan.id, toPlanKey: planKey },
  });
  await trackEvent('subscription_plan_changed', { workspaceId }, { toPlan: planKey });

  return { success: true };
}

/**
 * FIX (HIGH-4): provider.refund() was implemented on the payment-provider
 * interface and by the Flutterwave provider, but nothing in the
 * application ever called it — no admin action, no way to record a
 * refund happening. Scoped narrowly: refunds the subscription's most
 * recent successful payment and cancels the subscription outright
 * (status: 'canceled') rather than leaving it 'active' against a
 * refunded charge. This does NOT yet handle Flutterwave-initiated
 * disputes/chargebacks arriving via webhook — that needs Flutterwave's
 * exact dispute/chargeback event-type name before it can be wired up
 * automatically (open question, see BACKEND_READINESS_OVERVIEW.md) —
 * this endpoint covers the admin/support-initiated case in the meantime.
 */
export async function refundSubscriptionPayment(subscriptionId: string, actorUserId: string) {
  const { data: sub } = await supabaseAdmin()
    .from('subscriptions')
    .select('id, workspace_id')
    .eq('id', subscriptionId)
    .single();
  if (!sub) throw ApiError.notFound('Subscription not found.');

  const { data: lastTx } = await supabaseAdmin()
    .from('payment_transactions')
    .select('id, provider_tx_id, amount')
    .eq('subscription_id', subscriptionId)
    .eq('status', 'successful')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastTx) throw ApiError.badRequest('No successful payment found for this subscription to refund.');
  if (!lastTx.provider_tx_id) {
    // Only possible for a payment recorded before migration 0005 added
    // provider_tx_id (its backfill only covers card_token, not this
    // field — see that migration's comment for why).
    throw ApiError.badRequest('This payment predates refund tracking and cannot be refunded automatically. Please refund it directly with the payment provider.');
  }

  const provider = getProvider();
  const result = await provider.refund(lastTx.provider_tx_id);
  if (!result.success) throw ApiError.internal('Refund failed at the payment provider.');

  await supabaseAdmin().from('payment_transactions').update({ status: 'refunded' }).eq('id', lastTx.id);
  await supabaseAdmin()
    .from('subscriptions')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .eq('id', sub.id);
  await supabaseAdmin().from('audit_log').insert({
    actor_user_id: actorUserId,
    workspace_id: sub.workspace_id,
    action: 'subscription_refunded',
    target_type: 'subscription',
    target_id: sub.id,
    metadata: { paymentTransactionId: lastTx.id, providerTxId: lastTx.provider_tx_id, amount: lastTx.amount },
  });

  return { success: true };
}

export async function getUsage(workspaceId: string) {
  const periodStart = new Date();
  periodStart.setDate(1);
  periodStart.setHours(0, 0, 0, 0);

  const [{ count: sessions }, { count: personas }, { count: playbooks }] = await Promise.all([
    supabaseAdmin().from('practice_sessions').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('created_at', periodStart.toISOString()),
    supabaseAdmin().from('personas').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('created_at', periodStart.toISOString()).not('source_type', 'eq', 'generated'),
    supabaseAdmin().from('playbooks').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
  ]);

  const subscription = await getCurrentSubscription(workspaceId);
  return {
    sessions_this_period: sessions ?? 0,
    personas_from_document_this_period: personas ?? 0,
    playbooks_total: playbooks ?? 0,
    plan: subscription?.plans ?? null,
  };
}

// FIX (audit finding H3): listInvoices() used to live here as a plain,
// fully-unbounded query, inconsistent with this codebase's established
// convention of doing cursor pagination at the ROUTE layer (see
// session.routes.ts's GET /, notifications.routes.ts's GET /,
// playbook.routes.ts's GET /playbooks — every other fetchCursorPage call
// site is a route handler, not a service function). Moved to
// billing.routes.ts's GET /invoices directly rather than kept here, so
// this module doesn't become the one place that breaks that layering.
