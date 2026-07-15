import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { trackEvent } from '../analytics/analytics.service';

const router = Router();

const instantSetupSchema = z.object({
  product_description: z.string().min(1).max(1000),
  target_audience: z.string().min(1).max(1000),
  tone_preference: z.string().max(300).optional(),
});

router.post(
  '/instant-setup',
  validate({ body: instantSetupSchema }),
  asyncHandler(async (req, res) => {
    const { error } = await supabaseAdmin().from('practice_profiles').upsert(
      {
        user_id: req.user!.id,
        workspace_id: req.workspace!.id,
        product_description: req.body.product_description,
        target_audience: req.body.target_audience,
        tone_preference: req.body.tone_preference ?? null,
      },
      { onConflict: 'user_id,workspace_id' }
    );
    if (error) throw ApiError.internal('Failed to save your setup.');

    await supabaseAdmin()
      .from('users')
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq('id', req.user!.id);

    await trackEvent('practice_profile_completed', { userId: req.user!.id, workspaceId: req.workspace!.id }, {});
    res.json({ success: true });
  })
);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json({ onboarding_completed: !!req.user!.onboardingCompletedAt });
  })
);

export default router;
