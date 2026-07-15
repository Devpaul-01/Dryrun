import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { redisConnection } from '../../config/redis';
import { createLogger } from '../../config/logger';

const log = createLogger('purge-soft-deleted-worker');
const GRACE_PERIOD_DAYS = 14;

/**
 * Compliance-relevant job — failures here are alert-worthy, not just logged
 * (architecture doc §11.2). A narrow distributed lock prevents two worker
 * instances from double-processing the same purge batch.
 */
export async function purgeSoftDeletedAccountsHandler(_job: Job): Promise<void> {
  const redis = redisConnection();
  const lockKey = 'purge-soft-deleted-accounts-lock';
  const acquired = await redis.set(lockKey, '1', 'PX', 5 * 60 * 1000, 'NX');
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
        continue;
      }

      // Cascades handle practice_sessions, personas, practice_profiles, etc.
      // per the FK cascade rules (db/migrations).
      await supabaseAdmin().from('users').delete().eq('id', user.id);
      await supabaseAdmin().auth.admin.deleteUser(user.id);
      log.info({ userId: user.id }, 'Hard-purged soft-deleted account');
    }
  } catch (err) {
    log.error({ err }, 'ALERT: purge_soft_deleted_accounts failed');
    throw err; // surfaces as a dead-lettered, alerted failure per architecture §11.2/§18
  } finally {
    await redis.del(lockKey);
  }
}
