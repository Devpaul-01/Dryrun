-- Migration 0012: subscriptions.pending_tx_ref
--
-- MISSING MIGRATION, found and fixed during a backend takeover review by
-- actually running reconcile_successful_payment() (added in the next
-- migration, 0013) against a real Postgres 16 instance: it failed outright
-- with `ERROR: column "pending_tx_ref" does not exist`. The column is
-- referenced consistently across three application call sites —
-- billing.service.ts's initiateCheckout() (sets it) and confirmCheckout()
-- (matches on it), processWebhookEvent.worker.ts (matches on it), and
-- attemptRenewalCharge.worker.ts (passes p_clear_pending_tx_ref to the RPC)
-- — and billing.service.ts's own comments explicitly describe this column
-- and a "uq_subscriptions_pending_tx_ref partial unique index" as already
-- existing. Neither the column nor the index were ever actually created by
-- any migration; this closes that gap so the code that already assumes
-- them is finally correct, not just documented as if it were.
--
-- Without this column, every successful-payment reconciliation path —
-- checkout confirmation, Flutterwave webhook processing, and renewal
-- charges — fails at the database level. This is the most severe defect
-- found in this review: the billing system's "happy path" does not work.
--
-- SEMANTICS: pending_tx_ref holds the payment provider's transaction
-- reference for a subscription's in-flight (status = 'incomplete') checkout
-- or renewal attempt. It's set at checkout-creation time (initiateCheckout)
-- and cleared back to null once the attempt resolves (reconcile_successful_
-- payment's p_clear_pending_tx_ref parameter) — see billing.service.ts and
-- processWebhookEvent.worker.ts's own header comments for the cross-tenant
-- misattribution bug this column's exact-match lookup exists to prevent
-- (matching by this reference instead of "most recent incomplete/pending
-- subscription," which could resolve to the wrong workspace's row).
--
-- PARTIAL UNIQUE INDEX: unique only where pending_tx_ref is not null —
-- Postgres's own plain `unique` constraint already treats NULLs as
-- non-colliding, so a partial index here isn't strictly required for
-- correctness, but makes the intent explicit (matches what the
-- application code's comments already describe) and keeps the index
-- smaller by excluding the (eventually large) set of subscriptions that
-- are not currently mid-checkout.

alter table subscriptions add column pending_tx_ref text;

create unique index uq_subscriptions_pending_tx_ref
  on subscriptions (pending_tx_ref)
  where pending_tx_ref is not null;
