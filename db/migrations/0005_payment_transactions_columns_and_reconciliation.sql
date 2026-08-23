-- =============================================================================
-- 0005: payment_transactions columns + atomic payment reconciliation
-- =============================================================================
-- Part of the subscription/billing refinement pass. See
-- SUBSCRIPTION_BILLING_REFINEMENT.md for the full findings this migration
-- closes (CRIT-3, HIGH-6, MED-5).
--
-- 1) payment_transactions.card_token / provider_tx_id — promotes two
--    fields that used to live only inside the inconsistently-shaped
--    `raw_payload` jsonb blob into real columns.
--
--    confirmCheckout (billing.service.ts) stored the full verification
--    RESULT object under raw_payload, which has a flat `cardToken` field.
--    processWebhookEvent.worker.ts instead stored the raw WEBHOOK PAYLOAD
--    (Flutterwave's own body shape, no flat `cardToken` field at all).
--    attemptRenewalCharge.worker.ts's `raw_payload.cardToken` lookup
--    therefore silently came back empty depending on which of the two
--    paths recorded a subscription's first successful payment, causing a
--    perfectly valid, tokenizable card to be treated as "no card on
--    file" and the subscription incorrectly pushed into dunning.
--
--    provider_tx_id (Flutterwave's own transaction id, distinct from our
--    own generated tx_ref) is promoted the same way — it's required
--    reliably by the admin refund endpoint (see migration 0008), which
--    calls the provider's refund-by-transaction-id API.
--
-- 2) idx_payment_transactions_subscription_created — the renewal
--    worker's "most recent successful payment for this subscription"
--    lookup had no supporting index. Postgres does not automatically
--    index foreign-key columns, and this query runs on every renewal
--    attempt.
--
-- 3) reconcile_successful_payment() — atomically performs the
--    subscription-status update, the payment_transactions insert, and
--    the audit_log insert that together record a successful payment.
--    These three writes used to be three separate, unwrapped Supabase
--    REST calls in confirmCheckout, processWebhookEvent.worker.ts, and
--    attemptRenewalCharge.worker.ts. A crash between them could activate
--    a subscription while permanently losing the payment_transactions
--    record, since a retry's lookup (by pending_tx_ref, which the first
--    call already cleared) would no longer match anything. Same class of
--    fix as allocate_session_sequence_index() in migration 0002, for the
--    identical underlying reason: atomicity the app layer cannot
--    otherwise guarantee through Supabase's REST interface.
-- =============================================================================

alter table payment_transactions add column card_token text;
alter table payment_transactions add column provider_tx_id text;

create index idx_payment_transactions_subscription_created
  on payment_transactions (subscription_id, created_at desc);

-- One-time backfill for rows written before this migration, so an
-- existing paying customer's very next renewal attempt doesn't
-- immediately (and incorrectly) treat them as cardless. Only recovers
-- card_token — provider_tx_id was never captured by either of the old
-- write paths, so it's left null for historical rows; it's only read by
-- the new refund endpoint (migration 0008), applied going forward.
update payment_transactions
set card_token = raw_payload ->> 'cardToken'
where card_token is null
  and raw_payload ? 'cardToken';

create or replace function reconcile_successful_payment(
  p_subscription_id uuid,
  p_workspace_id uuid,
  p_provider_tx_ref text,
  p_amount numeric,
  p_currency text,
  p_card_token text,
  p_provider_tx_id text,
  p_raw_payload jsonb,
  p_new_status subscription_status,
  p_new_period_start timestamptz,
  p_new_period_end timestamptz,
  p_clear_pending_tx_ref boolean,
  p_audit_action text,
  p_audit_actor_user_id uuid,
  p_audit_metadata jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_payment_id uuid;
begin
  update subscriptions
  set
    status = p_new_status,
    current_period_start = coalesce(p_new_period_start, current_period_start),
    current_period_end = coalesce(p_new_period_end, current_period_end),
    pending_tx_ref = case when p_clear_pending_tx_ref then null else pending_tx_ref end
  where id = p_subscription_id;

  insert into payment_transactions (
    workspace_id, subscription_id, provider_tx_ref, amount, currency,
    status, card_token, provider_tx_id, raw_payload
  ) values (
    p_workspace_id, p_subscription_id, p_provider_tx_ref, p_amount, p_currency,
    'successful', p_card_token, p_provider_tx_id, p_raw_payload
  )
  returning id into v_payment_id;

  if p_audit_action is not null then
    insert into audit_log (workspace_id, actor_user_id, action, target_type, target_id, metadata)
    values (
      p_workspace_id, p_audit_actor_user_id, p_audit_action, 'subscription',
      p_subscription_id::text, coalesce(p_audit_metadata, '{}'::jsonb)
    );
  end if;

  return v_payment_id;
end;
$$;
