import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';

const router = Router();

const notificationPrefsSchema = z.object({
  weekly_summary_enabled: z.boolean().optional(),
  async_ready_push_enabled: z.boolean().optional(),
});

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

export default router;
