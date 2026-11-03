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
    // FIX (found during the backend-takeover coaching-module review, ahead
    // of the mobile client build): this used to read
    // req.user.onboarding_completed_at — a flag on the users table, set
    // once, ever. But the actual onboarding DATA (practice_profiles —
    // product description, target audience) is scoped per (user,
    // workspace), same as everything else in this product. A user who
    // completes onboarding in Workspace A and later joins Workspace B via
    // invite would see onboarding_completed: true there too, despite
    // having no practice profile in B — and then get a confusing 400
    // ("Complete Instant Setup...") from session.service.ts's
    // getPracticeProfile the moment they tried to start a session, having
    // just been told they were done. Now derives the answer directly from
    // whether a practice_profiles row exists for THIS workspace, making
    // that table the single source of truth instead of a separately
    // tracked flag that can drift from it. users.onboarding_completed_at
    // itself is left in place (harmless, and POST /instant-setup still
    // sets it) since nothing else in the codebase reads it.
    const { data } = await supabaseAdmin()
      .from('practice_profiles')
      .select('id')
      .eq('user_id', req.user!.id)
      .eq('workspace_id', req.workspace!.id)
      .maybeSingle();
    res.json({ onboarding_completed: !!data });
  })
);

export default router;
