import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { enqueue } from '../../jobs/queues';

const router = Router();

const updateUserSchema = z.object({
  display_name: z.string().min(1).max(120).optional(),
});

const notificationPrefsSchema = z.object({
  weekly_summary_enabled: z.boolean().optional(),
  async_ready_push_enabled: z.boolean().optional(),
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

router.get(
  '/notification-preferences',
  asyncHandler(async (req, res) => {
    const { data } = await supabaseAdmin()
      .from('notification_preferences')
      .select('*')
      .eq('user_id', req.user!.id)
      .maybeSingle();
    res.json({ preferences: data ?? { weekly_summary_enabled: true, async_ready_push_enabled: false } });
  })
);

router.patch(
  '/notification-preferences',
  validate({ body: notificationPrefsSchema }),
  asyncHandler(async (req, res) => {
    const { data, error } = await supabaseAdmin()
      .from('notification_preferences')
      .upsert({ user_id: req.user!.id, ...req.body }, { onConflict: 'user_id' })
      .select('*')
      .single();
    if (error) throw ApiError.internal('Failed to update preferences.');
    res.json({ preferences: data });
  })
);

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const jobId = await enqueue('maintenance', 'export_user_data', { userId: req.user!.id });
    res.status(202).json({ job_id: jobId, message: 'Your export is being prepared. You will be notified when it is ready.' });
  })
);

export default router;
