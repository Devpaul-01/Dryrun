import type { Plan, Subscription } from '@/types/api';

export type BillingState = 'free' | 'pending_payment' | 'active' | 'cancelling' | 'past_due' | 'canceled';

/**
 * Collapses the subscription row into one state the UI can switch on.
 * Cancellation is effective at period end, so `canceled_at` on an `active`
 * row means "cancelling", not "canceled" (backend billing.service.ts).
 * A null row, or an `incomplete` row (checkout started, unpaid), means the
 * workspace is entitled to nothing beyond the free plan.
 */
export function billingState(sub: Subscription | null | undefined): BillingState {
  if (!sub) return 'free';
  switch (sub.status) {
    case 'active':
    case 'trialing':
      return sub.canceled_at ? 'cancelling' : 'active';
    case 'past_due':
      return 'past_due';
    case 'incomplete':
      return 'pending_payment';
    case 'canceled':
      return 'canceled';
    default:
      return 'free';
  }
}

export type PlanAction = 'current' | 'checkout' | 'change' | 'none';

/** What the button on a plan card does. Paid plans only; `free` is reached by cancelling. */
export function planAction(plan: Plan, sub: Subscription | null | undefined): PlanAction {
  const state = billingState(sub);
  const isPaid = Number(plan.price_amount) > 0;
  const onThisPlan = sub?.plans?.key === plan.key;
  if (state === 'active' || state === 'cancelling' || state === 'past_due') {
    if (onThisPlan) return 'current';
    return isPaid ? (state === 'past_due' ? 'none' : 'change') : 'none';
  }
  // free / pending_payment / canceled
  if (!isPaid) return state === 'free' || state === 'canceled' || state === 'pending_payment' ? 'current' : 'none';
  return 'checkout';
}

/** Feature bullets for a plan card, from the plan row's own limits (never hard-coded per plan key). */
export function planFeatures(plan: Plan): string[] {
  const f = plan.features as { persona_from_document?: boolean; playbook_limit?: number | null; voice_mode?: boolean };
  const out: string[] = [];
  out.push(plan.session_limit_per_month == null ? 'Unlimited practice sessions' : `${plan.session_limit_per_month} practice sessions a month`);
  out.push(f.playbook_limit == null ? 'Unlimited playbooks' : `${f.playbook_limit} playbook${f.playbook_limit === 1 ? '' : 's'}`);
  out.push(f.persona_from_document ? 'Build buyers from documents' : 'Buyers from documents not included');
  if (f.voice_mode) out.push('Voice mode');
  if (plan.seat_based) out.push('Priced per seat');
  return out;
}
