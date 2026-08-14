import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';

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
