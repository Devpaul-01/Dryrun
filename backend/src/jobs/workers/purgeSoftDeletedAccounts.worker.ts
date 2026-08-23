import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { redisConnection } from '../../config/redis';
import { createLogger } from '../../config/logger';
import * as billingService from '../../modules/billing/billing.service';
import { ApiError } from '../../lib/apiError';

const log = createLogger('purge-soft-deleted-worker');
const GRACE_PERIOD_DAYS = 14;
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes — see the heartbeat note below for why a fixed TTL alone isn't the whole story

/**
 * Compliance-relevant job — failures here are alert-worthy, not just logged
 * (architecture doc §11.2). A narrow distributed lock prevents two worker
 * instances from double-processing the same purge batch.
 *
 * FIX (audit finding M4): the lock's TTL used to be a single fixed 5
 * minutes with no refresh — for each candidate user, this handler does a
 * full extra query for owned workspaces, then a further query PER owned
 * workspace for active-member count, before the actual delete (a genuine
 * N×M query pattern, entirely sequential, no batching). If a candidate
 * batch ever grew large enough that a full run exceeded 5 minutes, the
 * lock could expire mid-run, letting a second scheduled/retried
 * invocation start concurrently with the still-running first one — for a
 * job explicitly described as compliance-relevant, processing hard
 * account deletion. Fixed with a heartbeat: the lock's TTL is refreshed
 * after each candidate finishes processing, so its lifetime tracks actual
 * progress through the batch rather than a single fixed guess made
 * up front — a batch that's still making progress never loses its lock,
 * while a genuinely stuck/crashed run still releases the lock naturally
 * once LOCK_TTL_MS elapses with no refresh.
 */
export async function purgeSoftDeletedAccountsHandler(_job: Job): Promise<void> {
  const redis = redisConnection();
  const lockKey = 'purge-soft-deleted-accounts-lock';
  const acquired = await redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX');
  if (!acquired) return;

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - GRACE_PERIOD_DAYS);

    const { data: candidates, error } = await supabaseAdmin()
      .from('users')
      .select('id')
      .lt('deleted_at', cutoff.toISOString())
      .not('deleted_at', 'is', null);

    if (error) {
      log.error({ error }, 'ALERT: failed to query soft-deleted accounts for purge');
      throw error;
    }

    for (const user of candidates ?? []) {
      // Sole-owner block: skip (never force-delete) if this user is still
      // the sole owner of a multi-member workspace — this should not be
      // reachable given the block at deletion-request time, but is
      // re-checked here as a defensive last line.
      const { data: soleOwnerWorkspaces } = await supabaseAdmin()
        .from('workspaces')
        .select('id')
        .eq('owner_user_id', user.id);

      let blocked = false;
      for (const ws of soleOwnerWorkspaces ?? []) {
        const { count } = await supabaseAdmin()
          .from('workspace_members')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', ws.id)
          .eq('status', 'active');
        if ((count ?? 0) > 1) blocked = true;
      }
      if (blocked) {
        log.warn({ userId: user.id }, 'Skipping purge — user is still sole owner of a multi-member workspace');
        // Heartbeat even on the skip path — this candidate still consumed
        // real time (the N×M queries above), so the lock's remaining
        // lifetime should reflect that regardless of outcome.
        await redis.pexpire(lockKey, LOCK_TTL_MS);
        continue;
      }

      // Cascades handle practice_sessions, personas, practice_profiles, etc.
      // per the FK cascade rules (db/migrations).
      await supabaseAdmin().from('users').delete().eq('id', user.id);
      await supabaseAdmin().auth.admin.deleteUser(user.id);
      log.info({ userId: user.id }, 'Hard-purged soft-deleted account');

      // FIX (HIGH-8): every workspace in soleOwnerWorkspaces is now
      // ownerless AND memberless — workspaces.owner_user_id was just set
      // to null by the FK's `on delete set null`, and the user's own
      // workspace_members row cascaded away with them (the sole-owner
      // block above already guaranteed none of these workspaces had any
      // OTHER active member). Left alone, this is a permanently orphaned
      // workspace row. cancelSubscription() here is defensive — the
      // normal path is profile.routes.ts's DELETE /me already canceling
      // any active subscription up front (CRIT-5) — but this covers an
      // account being purged via any path that skipped that step, so a
      // subscription can never keep being picked up by checkRenewalsDue()
      // and charged against a workspace with no owner left to notify.
      for (const ws of soleOwnerWorkspaces ?? []) {
        try {
          await billingService.cancelSubscription(ws.id);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) {
            log.warn({ err, workspaceId: ws.id }, 'Failed to defensively cancel subscription on orphaned workspace');
          }
        }

        const { error: deleteWorkspaceError } = await supabaseAdmin().from('workspaces').delete().eq('id', ws.id);
        if (deleteWorkspaceError) {
          log.warn({ err: deleteWorkspaceError, workspaceId: ws.id }, 'Failed to clean up orphaned workspace after account purge');
        } else {
          log.info({ workspaceId: ws.id }, 'Deleted orphaned workspace (sole owner purged, zero remaining members)');
        }
      }

      // Heartbeat: refresh the lock's TTL now that this candidate is fully
      // processed, so a long-running batch never loses its lock mid-way
      // through, while a crashed/stuck run still naturally releases it.
      await redis.pexpire(lockKey, LOCK_TTL_MS);
    }
  } catch (err) {
    log.error({ err }, 'ALERT: purge_soft_deleted_accounts failed');
    throw err; // surfaces as a dead-lettered, alerted failure per architecture §11.2/§18
  } finally {
    await redis.del(lockKey);
  }
}
