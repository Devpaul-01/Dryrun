import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { createFreshTestDb, dropTestDb } from '../helpers/testDb';

/**
 * Regression coverage for reconcile_successful_payment() (migration
 * 0013_payment_transactions_columns_and_reconciliation.sql), the single
 * Postgres function all three successful-payment paths call atomically:
 * checkout confirmation (billing.service.ts's confirmCheckout), the
 * Flutterwave webhook worker, and renewal charges.
 *
 * AUDIT.md Pass 1/Pass 3 found two bugs here by applying every migration
 * against a real Postgres instance and actually calling the function —
 * not by reading the SQL. This suite exists so those two bugs (and the
 * happy path they were blocking) stay fixed:
 *
 * 1. subscriptions.pending_tx_ref didn't exist until migration 0012 —
 *    calling the RPC failed outright with "column does not exist".
 * 2. The function's own audit_log insert cast p_subscription_id to text,
 *    but audit_log.target_id is uuid — failed with a type-mismatch error,
 *    fully masked until bug 1 was fixed (the function never reached that
 *    line before).
 *
 * Both are schema/SQL-level failures a mocked Supabase client can't
 * catch, so this suite runs against a real, freshly migrated Postgres
 * database rather than mocking the database layer.
 */
describe('reconcile_successful_payment()', () => {
  let client: Client;
  let planId: string;

  beforeAll(async () => {
    client = await createFreshTestDb();

    // 'pro' is seeded by migration 0005_billing_domain.sql — reuse it
    // rather than inserting a conflicting duplicate.
    const plan = await client.query(`select id from plans where key = 'pro'`);
    planId = plan.rows[0].id;
  }, 30000);

  afterAll(async () => {
    await dropTestDb(client);
  });

  // Each test gets its OWN workspace rather than sharing one across the
  // suite: migration 0014_one_active_subscription_per_workspace.sql adds
  // a unique index allowing at most one 'active' subscription per
  // workspace at a time, and several tests here activate a subscription
  // with status = 'active' — sharing a workspace would make test order
  // matter and risk a unique-violation that has nothing to do with what
  // each test is actually checking.
  async function insertIncompleteSubscription(pendingTxRef: string) {
    const workspace = await client.query(`insert into workspaces (name) values ('Acme Inc') returning id`);
    const workspaceId = workspace.rows[0].id as string;

    const result = await client.query(
      `insert into subscriptions (workspace_id, plan_id, status, pending_tx_ref)
       values ($1, $2, 'incomplete', $3)
       returning id`,
      [workspaceId, planId, pendingTxRef]
    );
    return { subscriptionId: result.rows[0].id as string, workspaceId };
  }

  it('applies the full happy path atomically: activates the subscription, records the payment, and writes an audit log entry', async () => {
    const pendingTxRef = 'tx_ref_happy_path';
    const { subscriptionId, workspaceId } = await insertIncompleteSubscription(pendingTxRef);
    const periodStart = new Date('2026-11-01T00:00:00Z');
    const periodEnd = new Date('2026-12-01T00:00:00Z');

    const result = await client.query(
      `select reconcile_successful_payment(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      ) as payment_id`,
      [
        subscriptionId,
        workspaceId,
        pendingTxRef,
        49.0,
        'USD',
        'card_tok_abc123',
        'flw_provider_tx_999',
        JSON.stringify({ sample: 'payload' }),
        'active',
        periodStart,
        periodEnd,
        true, // p_clear_pending_tx_ref
        'subscription.activated',
        null, // p_audit_actor_user_id
        JSON.stringify({ source: 'test' }),
      ]
    );

    const paymentId = result.rows[0].payment_id;
    expect(paymentId).toBeTruthy();

    const sub = await client.query(`select * from subscriptions where id = $1`, [subscriptionId]);
    expect(sub.rows[0].status).toBe('active');
    expect(sub.rows[0].pending_tx_ref).toBeNull();
    expect(new Date(sub.rows[0].current_period_start).toISOString()).toBe(periodStart.toISOString());
    expect(new Date(sub.rows[0].current_period_end).toISOString()).toBe(periodEnd.toISOString());

    const payment = await client.query(`select * from payment_transactions where id = $1`, [paymentId]);
    expect(payment.rows).toHaveLength(1);
    expect(payment.rows[0].status).toBe('successful');
    expect(payment.rows[0].card_token).toBe('card_tok_abc123');
    expect(payment.rows[0].provider_tx_id).toBe('flw_provider_tx_999');
    expect(payment.rows[0].provider_tx_ref).toBe(pendingTxRef);
    expect(Number(payment.rows[0].amount)).toBe(49);

    // Regression guard for Finding 2 (AUDIT.md Pass 1/3): this insert
    // used to fail outright with "column target_id is of type uuid but
    // expression is of type text" because of an erroneous ::text cast.
    // If that regresses, this query returns zero rows instead of one.
    const audit = await client.query(
      `select * from audit_log where target_type = 'subscription' and target_id = $1`,
      [subscriptionId]
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe('subscription.activated');
    expect(audit.rows[0].target_id).toBe(subscriptionId); // uuid column, uuid value — not text
    expect(audit.rows[0].metadata).toEqual({ source: 'test' });
  });

  it('leaves pending_tx_ref untouched when p_clear_pending_tx_ref is false (the renewal-charge path, where no checkout is in flight)', async () => {
    const pendingTxRef = 'tx_ref_renewal_keep';
    const { subscriptionId, workspaceId } = await insertIncompleteSubscription(pendingTxRef);

    await client.query(
      `select reconcile_successful_payment(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )`,
      [
        subscriptionId,
        workspaceId,
        'tx_ref_renewal_actual',
        49.0,
        'USD',
        'card_tok_def456',
        'flw_provider_tx_1000',
        JSON.stringify({}),
        'active',
        new Date(),
        new Date(),
        false, // p_clear_pending_tx_ref
        null, // no audit entry this time
        null,
        null,
      ]
    );

    const sub = await client.query(`select pending_tx_ref from subscriptions where id = $1`, [subscriptionId]);
    expect(sub.rows[0].pending_tx_ref).toBe(pendingTxRef);
  });

  it('skips the audit_log insert when p_audit_action is null, without affecting the other two writes', async () => {
    const { subscriptionId, workspaceId } = await insertIncompleteSubscription('tx_ref_no_audit');

    const result = await client.query(
      `select reconcile_successful_payment(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      ) as payment_id`,
      [
        subscriptionId,
        workspaceId,
        'tx_ref_no_audit',
        49.0,
        'USD',
        null,
        null,
        JSON.stringify({}),
        'active',
        new Date(),
        new Date(),
        true,
        null, // p_audit_action
        null,
        null,
      ]
    );

    const payment = await client.query(`select * from payment_transactions where id = $1`, [result.rows[0].payment_id]);
    expect(payment.rows).toHaveLength(1);

    const audit = await client.query(`select * from audit_log where target_id = $1`, [subscriptionId]);
    expect(audit.rows).toHaveLength(0);
  });

  it('respects coalesce semantics: a null new period start/end leaves the existing period untouched', async () => {
    const { subscriptionId, workspaceId } = await insertIncompleteSubscription('tx_ref_coalesce');
    const originalStart = new Date('2026-01-01T00:00:00Z');
    const originalEnd = new Date('2026-02-01T00:00:00Z');
    await client.query(`update subscriptions set current_period_start = $1, current_period_end = $2 where id = $3`, [
      originalStart,
      originalEnd,
      subscriptionId,
    ]);

    await client.query(
      `select reconcile_successful_payment(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )`,
      [
        subscriptionId,
        workspaceId,
        'tx_ref_coalesce_resolve',
        49.0,
        'USD',
        null,
        null,
        JSON.stringify({}),
        'active',
        null, // p_new_period_start
        null, // p_new_period_end
        true,
        null,
        null,
        null,
      ]
    );

    const sub = await client.query(`select current_period_start, current_period_end from subscriptions where id = $1`, [
      subscriptionId,
    ]);
    expect(new Date(sub.rows[0].current_period_start).toISOString()).toBe(originalStart.toISOString());
    expect(new Date(sub.rows[0].current_period_end).toISOString()).toBe(originalEnd.toISOString());
  });
});
