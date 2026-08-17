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

  await supabaseAdmin()
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      // Cleared on activation, mirroring processWebhookEvent.worker.ts's
      // existing correct behavior — a pending_tx_ref that's already been
      // consumed should never be matchable again.
      pending_tx_ref: null,
    })
    .eq('id', sub.id);

  await supabaseAdmin().from('payment_transactions').insert({
    workspace_id: workspaceId,
    subscription_id: sub.id,
    provider_tx_ref: providerTxRef,
    amount: result.amount,
    currency: result.currency,
    status: 'successful',
    raw_payload: result,
  });

  await supabaseAdmin().from('audit_log').insert({
    workspace_id: workspaceId,
    action: 'subscription_activated',
    target_type: 'subscription',
    target_id: sub.id,
    metadata: { providerTxRef },
  });

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
 * FIX (audit finding M1): this used to update seats_purchased with no
 * audit_log entry at all, despite every other consequential billing
 * mutation in this file (checkout confirmation, and — once this fix
 * lands — subscription renewal) writing one. actorUserId is threaded
 * through from the route (req.user!.id, always the authenticated caller,
 * gated by requireRole('owner','admin') at the route) so this entry can
 * name who actually took the action, matching the fuller audit-entry
 * convention used by workspace.service.ts's removeMember/updateMemberRole.
 */
export async function addSeats(workspaceId: string, additionalSeats: number, actorUserId: string) {
  const { data: workspace } = await supabaseAdmin().from('workspaces').select('seats_purchased').eq('id', workspaceId).single();
  const newSeatCount = (workspace?.seats_purchased ?? 1) + additionalSeats;
  await supabaseAdmin().from('workspaces').update({ seats_purchased: newSeatCount }).eq('id', workspaceId);
  await supabaseAdmin().from('audit_log').insert({
    actor_user_id: actorUserId,
    workspace_id: workspaceId,
    action: 'seats_added',
    target_type: 'workspace',
    target_id: workspaceId,
    metadata: { additionalSeats, newSeatCount },
  });
  return { seats_purchased: newSeatCount };
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
