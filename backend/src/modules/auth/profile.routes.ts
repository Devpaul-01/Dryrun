import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import * as billingService from '../billing/billing.service';
import { createLogger } from '../../config/logger';

const log = createLogger('profile-routes');

/**
 * Split out of the original user.routes.ts (item #14, router
 * refactoring): account-profile actions (update, soft-delete) are a
 * distinct concern from notification preferences and data export, which
 * now live in notificationPreferences.routes.ts and export.routes.ts
 * respectively. All three are still mounted under /api/v1/user in
 * app.ts, so the public route paths are unchanged.
 */
const router = Router();

const updateUserSchema = z.object({
  display_name: z.string().min(1).max(120).optional(),
});

router.patch(
  '/me',
  validate({ body: updateUserSchema }),
  asyncHandler(async (req, res) => {
    const { data, error } = await supabaseAdmin()
      .from('users')
      .update(req.body)
      .eq('id', req.user!.id)
      .select('*')
      .single();
    if (error) throw ApiError.internal('Failed to update profile.');
    res.json({ user: data });
  })
);

/**
 * Soft-delete → 14-day grace period → hard purge (jobs/workers/purgeSoftDeletedAccounts.worker.ts).
 * Blocked if the user is the sole owner of a multi-member workspace without
 * a completed ownership transfer.
 */
router.delete(
  '/me',
  asyncHandler(async (req, res) => {
    const { data: ownedWorkspaces } = await supabaseAdmin()
      .from('workspaces')
      .select('id, workspace_members(count)')
      .eq('owner_user_id', req.user!.id);

    for (const ws of ownedWorkspaces ?? []) {
      const { count } = await supabaseAdmin()
        .from('workspace_members')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws.id)
        .eq('status', 'active');
      if ((count ?? 0) > 1) {
        throw ApiError.conflict('Transfer ownership of your workspace(s) before deleting your account.');
      }
    }

    // FIX (CRIT-5): cancel any active subscription on a workspace this
    // user owns BEFORE soft-deleting the account. Without this, the
    // subscription kept renewing — and getting charged — against a
    // workspace that becomes ownerless once the 14-day grace period
    // elapses and the account is hard-purged (see
    // purgeSoftDeletedAccounts.worker.ts). Best-effort per workspace: a
    // failure here is logged loudly (this is a real money problem, not
    // just a data-quality one) but must not block the deletion request
    // itself — the user has already passed the sole-ownership check
    // above, and cancelSubscription() 404s harmlessly if there's nothing
    // active to cancel.
    for (const ws of ownedWorkspaces ?? []) {
      try {
        await billingService.cancelSubscription(ws.id);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          continue; // no active subscription on this workspace — nothing to cancel
        }
        log.error({ err, workspaceId: ws.id, userId: req.user!.id }, 'ALERT: failed to cancel subscription during account deletion');
      }
    }

    await supabaseAdmin().from('users').update({ deleted_at: new Date().toISOString() }).eq('id', req.user!.id);
    await supabaseAdmin().from('audit_log').insert({
      actor_user_id: req.user!.id,
      action: 'account_deletion_requested',
      target_type: 'user',
      target_id: req.user!.id,
      metadata: {},
    });
    res.json({ success: true, message: 'Account scheduled for deletion. You have 14 days to recover it by logging back in.' });
  })
);

export default router;
