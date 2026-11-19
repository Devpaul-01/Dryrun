import type { Plan, Subscription } from '@/types/api';
import { billingState, planAction, planFeatures } from '@/utils/billingState';

const plan = (key: string, price: number, extra: Partial<Plan> = {}): Plan => ({
  id: key, key, name: key, price_amount: price, currency: 'USD', billing_interval: 'monthly',
  session_limit_per_month: null, features: { persona_from_document: true, playbook_limit: null }, ...extra,
});
const sub = (status: Subscription['status'], p: Plan, canceled_at: string | null = null): Subscription => ({
  id: 's', status, current_period_start: null, current_period_end: null, canceled_at, plans: p,
});
const free = plan('free', 0, { session_limit_per_month: 4, features: { persona_from_document: false, playbook_limit: 1 } });
const pro = plan('pro', 18);
const team = plan('team', 18, { seat_based: true });

describe('billingState', () => {
  it('maps rows to states', () => {
    expect(billingState(null)).toBe('free');
    expect(billingState(sub('active', pro))).toBe('active');
    expect(billingState(sub('active', pro, '2026-11-01'))).toBe('cancelling');
    expect(billingState(sub('incomplete', pro))).toBe('pending_payment');
    expect(billingState(sub('past_due', pro))).toBe('past_due');
    expect(billingState(sub('canceled', pro))).toBe('canceled');
  });
});

describe('planAction', () => {
  it('offers checkout to free workspaces and marks free as current', () => {
    expect(planAction(pro, null)).toBe('checkout');
    expect(planAction(free, null)).toBe('current');
  });
  it('offers change between paid plans and marks the active one current', () => {
    const s = sub('active', pro);
    expect(planAction(pro, s)).toBe('current');
    expect(planAction(team, s)).toBe('change');
    expect(planAction(free, s)).toBe('none');
  });
  it('does not allow plan changes while past due', () => {
    expect(planAction(team, sub('past_due', pro))).toBe('none');
  });
  it('lets an unpaid checkout be retried', () => {
    expect(planAction(pro, sub('incomplete', pro))).toBe('checkout');
  });
});

describe('planFeatures', () => {
  it('reads limits from the plan row', () => {
    expect(planFeatures(free)).toEqual(['4 practice sessions a month', '1 playbook', 'Buyers from documents not included']);
    expect(planFeatures(team)).toContain('Priced per seat');
    expect(planFeatures(pro)[0]).toBe('Unlimited practice sessions');
  });
});
