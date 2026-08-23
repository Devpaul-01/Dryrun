import { getQueue } from './queues';
import { createLogger } from '../config/logger';
import { supabaseAdmin } from '../config/supabase';

const log = createLogger('scheduler');

interface ScheduleEntry {
  queue: 'maintenance' | 'ai-derivative';
  jobName: string;
  cron: string;
  data?: Record<string, unknown>;
}

const SCHEDULES: ScheduleEntry[] = [
  { queue: 'maintenance', jobName: 'purge_expired_demo_sessions', cron: '0 * * * *' }, // hourly
  { queue: 'maintenance', jobName: 'purge_soft_deleted_accounts', cron: '0 3 * * *' }, // daily 3am
  { queue: 'maintenance', jobName: 'purge_orphaned_uploads', cron: '30 * * * *' }, // hourly
  { queue: 'maintenance', jobName: 'archive_old_session_state_snapshots', cron: '0 4 * * 0' }, // weekly Sunday 4am
  { queue: 'maintenance', jobName: 'sample_ai_scoring_evaluations_for_review', cron: '0 5 * * 1' }, // weekly Monday 5am
  { queue: 'maintenance', jobName: 'dispatch_weekly_summaries', cron: '0 18 * * 0' }, // weekly Sunday 6pm
  { queue: 'maintenance', jobName: 'check_renewals_due', cron: '0 2 * * *' }, // daily 2am
];

/**
 * Idempotent registration, run once on worker-process startup.
 *
 * MIGRATION NOTE (replaces the previous getRepeatableJobs/
 * removeRepeatableByKey/add sequence and its accompanying manual Redis
 * lock): that trio is BullMQ's now-deprecated repeatable-jobs API
 * (explicit `@deprecated` JSDoc in bullmq, "will be removed in v6").
 * Beyond just being deprecated, it had a real correctness gap — the
 * read-existing -> delete -> re-add sequence wasn't atomic, so two
 * processes booting at the same time (two worker replicas, or two
 * combined-mode replicas via start-all.ts) could race each other,
 * which is why a manual SET NX PX lock was added around it during the
 * horizontal-scalability review.
 *
 * `upsertJobScheduler(id, repeatOpts, template)` replaces all of that in
 * one call: BullMQ implements it as a single server-side Lua script
 * (addJobScheduler), so "does a scheduler with this ID already exist,
 * and if so update it in place; otherwise create it" happens as one
 * atomic Redis operation — the same atomicity guarantee the manual lock
 * was approximating from the client side, now provided natively by the
 * library for exactly this operation. The manual lock is removed
 * entirely here, not just relocated, since it's no longer solving a
 * problem that still exists.
 *
 * Each schedule's `jobName` is used directly as its jobSchedulerId — it
 * was already the unique key the old code filtered existing repeatable
 * jobs by, so reusing it here needs no new identifier scheme.
 */
export async function registerSchedules(): Promise<void> {
  for (const entry of SCHEDULES) {
    const queue = getQueue(entry.queue);
    await queue.upsertJobScheduler(entry.jobName, { pattern: entry.cron }, { name: entry.jobName, data: entry.data ?? {} });
    log.info({ jobName: entry.jobName, cron: entry.cron }, 'Registered schedule');
  }
}

/**
 * `dispatch_weekly_summaries` fans out one send_weekly_summary job per
 * active user, rather than the scheduled entry itself doing per-user work —
 * keeps the scheduled job cheap and lets per-user sends retry independently.
 *
 * FIX (HIGH-7): excludes users with `deleted_at` set. workspace_members
 * .status isn't touched by soft-delete (a deleted-but-not-yet-purged user
 * is still 'active' there), so without this filter a user who requested
 * account deletion kept receiving weekly summary emails for the entire
 * 14-day grace period — a real trust problem, independent of whether
 * they're ever actually recovered. See workspace.routes.ts's members
 * query and workspace.service.ts#getAggregateTeamProgress for the
 * matching fix on the read side.
 */
export async function dispatchWeeklySummaries(): Promise<void> {
  const { enqueue } = await import('./queues');
  const { data: members } = await supabaseAdmin()
    .from('workspace_members')
    .select('user_id, workspace_id, users!inner(deleted_at)')
    .eq('status', 'active')
    .is('users.deleted_at', null);
  for (const m of members ?? []) {
    await enqueue('notifications', 'send_weekly_summary', { userId: m.user_id, workspaceId: m.workspace_id });
  }
}

/**
 * FIX (audit finding C5): closes the gap identified during the frontend-
 * readiness audit — nothing in the codebase previously triggered the
 * FIRST attempt_renewal_charge job when a subscription's billing period
 * ended. jobs/workers/attemptRenewalCharge.worker.ts's dunning/retry
 * chain was fully and correctly built (day 1/3/7 re-attempts, a narrow
 * distributed lock against double-charge, dunning-exhaustion cancellation)
 * but nothing ever dispatched a subscription into that chain in the first
 * place — a subscription that activated once would sit at status:'active'
 * with current_period_end in the past forever, never re-billed.
 *
 * ARCHITECTURE DECISION: DryRun (not Flutterwave) is responsible for
 * initiating every recurring charge. This is not a judgment call — it's
 * read directly off modules/billing/providers/flutterwave.provider.ts's
 * own class-level comment ("renewal is orchestrated by an explicit
 * scheduled job... never assumed to happen automatically on Flutterwave's
 * side") and confirmed structurally: initiateCharge()'s payload has no
 * plan/interval/subscription field anywhere (a one-time payment-link
 * charge, not Flutterwave's separate recurring-payment-plan product), and
 * chargeRenewal() exists specifically so DryRun can re-charge a
 * previously-captured card token later — a self-service pattern a
 * provider-driven integration would never need. Given that, the missing
 * piece was purely the "when do we start the first attempt" trigger — no
 * new webhook handling is needed, since chargeRenewal() already verifies
 * synchronously in the same call (see flutterwave.provider.ts), which is
 * already the confirmation mechanism for a renewal attempt.
 *
 * IDEMPOTENCY: deliberately does NOT need its own distributed lock or a
 * dispatched-marker column. The query itself (status = 'active' AND
 * current_period_end < now()) is self-limiting: attemptRenewalChargeHandler
 * unconditionally transitions a subscription's status away from
 * 'active'-with-a-stale-period_end on its very first run (to a fresh
 * 'active' with a pushed-out period_end on success, or to 'past_due' on
 * failure — see that worker's lines updating `status`), so a subscription
 * that's already had its first attempt dispatched naturally stops
 * matching this query on the next run, before a second dispatch could
 * ever see it again. The one residual window — this scan running twice in
 * quick succession before the first attempt has actually STARTED (so the
 * row hasn't transitioned yet) — is closed by giving the enqueue call a
 * deterministic idempotencyKey scoped to the subscription AND the exact
 * current_period_end being renewed (queues.ts's enqueue() already treats
 * a duplicate idempotencyKey as a BullMQ no-op); once a renewal succeeds,
 * current_period_end changes, so a future cycle's renewal gets a genuinely
 * new key rather than being permanently deduplicated away.
 *
 * FIX (CRIT-1): this used to select every `status = 'active'` subscription
 * past its period end with no regard for `canceled_at`. Cancellation
 * (billing.service.ts's cancelSubscription) is deliberately modeled as
 * "effective at period end" — `status` stays `'active'` and only
 * `canceled_at` is set, so access continues until the period genuinely
 * ends. That's the correct design; the bug was that this query couldn't
 * tell a subscription due for a normal renewal apart from one a customer
 * had already explicitly canceled, so a canceled subscription got
 * charged again exactly like a normal renewal. The query is now split
 * into two disjoint sets: real renewals (charge as before) and canceled-
 * and-now-expired subscriptions (finalize to `'canceled'` directly, no
 * charge, no dunning).
 */
export async function checkRenewalsDue(): Promise<void> {
  const { enqueue } = await import('./queues');
  const nowIso = new Date().toISOString();

  const { data: dueSubscriptions, error } = await supabaseAdmin()
    .from('subscriptions')
    .select('id, current_period_end')
    .eq('status', 'active')
    .is('canceled_at', null)
    .lt('current_period_end', nowIso);

  if (error) {
    log.error({ error }, 'ALERT: failed to query subscriptions due for renewal');
    throw error; // surfaces as a dead-lettered, alerted failure — this is billing-critical
  }

  for (const sub of dueSubscriptions ?? []) {
    await enqueue(
      'billing',
      'attempt_renewal_charge',
      { subscriptionId: sub.id },
      { idempotencyKey: `renewal-dispatch:${sub.id}:${sub.current_period_end}` }
    );
  }

  if (dueSubscriptions?.length) {
    log.info({ count: dueSubscriptions.length }, 'Dispatched renewal-charge attempts for subscriptions past their period end');
  }

  const { data: expiredCancellations, error: cancelError } = await supabaseAdmin()
    .from('subscriptions')
    .select('id, workspace_id, current_period_end')
    .eq('status', 'active')
    .not('canceled_at', 'is', null)
    .lt('current_period_end', nowIso);

  if (cancelError) {
    log.error({ error: cancelError }, 'ALERT: failed to query canceled subscriptions past their period end');
    throw cancelError;
  }

  for (const sub of expiredCancellations ?? []) {
    await supabaseAdmin().from('subscriptions').update({ status: 'canceled' }).eq('id', sub.id);
    await supabaseAdmin().from('audit_log').insert({
      workspace_id: sub.workspace_id,
      action: 'subscription_canceled_at_period_end',
      target_type: 'subscription',
      target_id: sub.id,
      metadata: {},
    });
  }

  if (expiredCancellations?.length) {
    log.info({ count: expiredCancellations.length }, 'Finalized canceled subscriptions past their period end (no charge attempted)');
  }
}
