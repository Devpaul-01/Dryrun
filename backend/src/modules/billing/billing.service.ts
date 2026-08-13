import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { flutterwaveProvider } from './providers/flutterwave.provider';
import { PaymentProvider } from './paymentProvider.interface';
import { env } from '../../config/env';
import { trackEvent } from '../analytics/analytics.service';
import { createLogger } from '../../config/logger';
import { cached, cacheKeys, CACHE_TTL } from '../../config/cache';

const log = createLogger('billing-service');

const providers: Record<string, PaymentProvider> = { flutterwave: flutterwaveProvider };
function getProvider(name = 'flutterwave'): PaymentProvider {
  return providers[name];
}

/**
 * Cached: the active plans catalog changes only via direct DB/admin-panel
 * action outside this codebase (no app code writes to `plans` at all —
 * confirmed by grep across every module), so a 30-minute TTL with no
 * explicit invalidation hook is safe. If an admin endpoint for editing
 * plans is added later, it must call
 * `invalidate(cacheKeys.plansActive())` (and the by-key/by-id variants
 * below) on write.
 */
export async function listPlans() {
  return cached(cacheKeys.plansActive(), { ttlSeconds: CACHE_TTL.STABLE_MINUTES_30 }, async () => {
    const { data } = await supabaseAdmin().from('plans').select('*').eq('is_active', true).order('price_amount', { ascending: true });
    return data ?? [];
  });
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
  const plan = await cached(cacheKeys.planByKey(planKey), { ttlSeconds: CACHE_TTL.STABLE_MINUTES_30 }, async () => {
    const { data } = await supabaseAdmin().from('plans').select('*').eq('key', planKey).single();
    return data ?? null;
  });
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

  await supabaseAdmin().from('subscriptions').insert({
    workspace_id: workspaceId,
    plan_id: plan.id,
    provider: provider.name,
    provider_customer_id: customer.providerCustomerId,
    status: 'incomplete',
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

  const { data: sub } = await supabaseAdmin()
    .from('subscriptions')
    .select('id, plan_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'incomplete')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!sub) throw ApiError.notFound('No pending checkout found for this workspace.');

  await supabaseAdmin()
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
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

export async function addSeats(workspaceId: string, additionalSeats: number) {
  const { data: workspace } = await supabaseAdmin().from('workspaces').select('seats_purchased').eq('id', workspaceId).single();
  const newSeatCount = (workspace?.seats_purchased ?? 1) + additionalSeats;
  await supabaseAdmin().from('workspaces').update({ seats_purchased: newSeatCount }).eq('id', workspaceId);
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

export async function listInvoices(workspaceId: string) {
  const { data } = await supabaseAdmin()
    .from('payment_transactions')
    .select('id, amount, currency, status, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  return data ?? [];
}
