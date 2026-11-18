import { httpClient } from '@/api/httpClient';
import type { CursorPage, Invoice, Plan, Subscription, Usage } from '@/types/api';

// Verified against backend billing.routes.ts. Subscription/checkout/cancel/change/invoices are owner|admin
// (cancel is owner-only); plans and usage are open to any member.

export function listPlans() {
  return httpClient.get<{ plans: Plan[] }>('/billing/plans').then((res) => res.data.plans);
}

export function getSubscription() {
  return httpClient.get<{ subscription: Subscription | null }>('/billing/subscription').then((res) => res.data.subscription);
}

export function getUsage() {
  return httpClient.get<{ usage: Usage }>('/billing/usage').then((res) => res.data.usage);
}

/** Creates an `incomplete` subscription row and returns the provider's hosted checkout page. */
export function startCheckout(planKey: string) {
  return httpClient
    .post<{ checkout_url: string; provider_tx_ref: string }>('/billing/checkout', { plan_key: planKey })
    .then((res) => res.data);
}

/** Verifies the transaction with the provider and activates the subscription. 400 while payment is unverified. */
export function confirmCheckout(txRef: string) {
  return httpClient.get<{ success: boolean }>(`/billing/checkout/${encodeURIComponent(txRef)}/status`).then((res) => res.data);
}

export function changePlan(planKey: string) {
  return httpClient.post<{ success: boolean }>('/billing/change-plan', { plan_key: planKey }).then((res) => res.data);
}

export function cancelSubscription() {
  return httpClient.post<{ effective_at: string | null }>('/billing/cancel').then((res) => res.data);
}

export function reactivateSubscription() {
  return httpClient.post<{ success: boolean }>('/billing/reactivate').then((res) => res.data);
}

export function listInvoices(cursor?: string) {
  return httpClient
    .get<CursorPage<Invoice>>('/billing/invoices', { params: cursor ? { cursor } : undefined })
    .then((res) => res.data);
}
