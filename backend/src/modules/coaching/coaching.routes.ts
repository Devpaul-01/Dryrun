import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { entitlement } from '../../middleware/entitlement';
import { canGeneratePlaybook } from '../billing/entitlements';
import { expensiveActionRateLimit } from '../../middleware/rateLimit';
import { withIdempotency } from '../../lib/idempotency';
import * as playbookService from './playbook.service';
import * as badgesService from './badges.service';
import * as curriculumService from './curriculum.service';
import { supabaseAdmin } from '../../config/supabase';

const router = Router();

const generatePlaybookSchema = z.object({
  persona_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  title: z.string().max(200).optional(),
});

router.get(
  '/playbooks',
  asyncHandler(async (req, res) => {
    const { data } = await supabaseAdmin()
      .from('playbooks')
      .select('id, title, created_at, share_token')
      .eq('workspace_id', req.workspace!.id)
      .order('created_at', { ascending: false });
    res.json({ playbooks: data ?? [] });
  })
);

router.post(
  '/playbooks',
  expensiveActionRateLimit,
  entitlement(canGeneratePlaybook),
  validate({ body: generatePlaybookSchema }),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    const playbook = await withIdempotency(idempotencyKey, 'generate_playbook', () =>
      playbookService.generatePlaybook({ workspaceId: req.workspace!.id, userId: req.user!.id, ...req.body })
    );
    res.status(201).json({ playbook });
  })
);

router.get(
  '/playbooks/:id',
  asyncHandler(async (req, res) => {
    const playbook = await playbookService.getPlaybookById(req.params.id, req.workspace!.id);
    res.json({ playbook });
  })
);

router.get(
  '/playbooks/:id/versions',
  asyncHandler(async (req, res) => {
    const versions = await playbookService.listPlaybookVersions(req.params.id, req.workspace!.id);
    res.json({ versions });
  })
);

router.post(
  '/playbooks/:id/regenerate',
  expensiveActionRateLimit,
  entitlement(canGeneratePlaybook),
  asyncHandler(async (req, res) => {
    const playbook = await playbookService.regeneratePlaybook(req.params.id, req.workspace!.id, req.user!.id);
    res.json({ playbook });
  })
);

router.post(
  '/playbooks/:id/share',
  validate({ body: z.object({ attribution_enabled: z.boolean().default(true) }) }),
  asyncHandler(async (req, res) => {
    const result = await playbookService.sharePlaybook(req.params.id, req.workspace!.id, req.body.attribution_enabled);
    res.json(result);
  })
);

router.delete(
  '/playbooks/:id/share',
  asyncHandler(async (req, res) => {
    await playbookService.revokeShare(req.params.id, req.workspace!.id);
    res.json({ success: true });
  })
);

/** Public, unauthenticated — mounted separately in app.ts under /public. */
export const publicPlaybookRouter = Router();
publicPlaybookRouter.get(
  '/playbooks/:token',
  asyncHandler(async (req, res) => {
    const playbook = await playbookService.getPublicPlaybook(req.params.token);
    res.json({ playbook });
  })
);

router.get(
  '/badges',
  asyncHandler(async (req, res) => {
    const badges = await badgesService.listBadges(req.user!.id);
    res.json({ badges });
  })
);

router.get(
  '/skill-trend',
  asyncHandler(async (req, res) => {
    const { data } = await supabaseAdmin()
      .from('user_skill_trend')
      .select('*')
      .eq('user_id', req.user!.id)
      .eq('workspace_id', req.workspace!.id)
      .order('period_start', { ascending: false })
      .limit(12);
    res.json({ trend: data ?? [] });
  })
);

router.get(
  '/skill-trend/goals',
  asyncHandler(async (req, res) => {
    const { data } = await supabaseAdmin()
      .from('session_goals')
      .select('goal_type, goal_achieved, practice_sessions!inner(user_id, workspace_id)')
      .eq('practice_sessions.user_id', req.user!.id)
      .eq('practice_sessions.workspace_id', req.workspace!.id);

    const byType = new Map<string, { total: number; achieved: number }>();
    for (const row of data ?? []) {
      const entry = byType.get(row.goal_type) ?? { total: 0, achieved: 0 };
      entry.total += 1;
      if (row.goal_achieved) entry.achieved += 1;
      byType.set(row.goal_type, entry);
    }
    const rates = Array.from(byType.entries()).map(([goalType, v]) => ({
      goal_type: goalType,
      rate: v.total > 0 ? Math.round((v.achieved / v.total) * 100) : 0,
      total: v.total,
    }));
    res.json({ goal_achievement_rates: rates });
  })
);

router.get(
  '/curriculum/current',
  asyncHandler(async (req, res) => {
    const curriculum = await curriculumService.getCurrentCurriculum(req.user!.id, req.workspace!.id);
    res.json({ curriculum });
  })
);

router.post(
  '/curriculum/dismiss',
  validate({ body: z.object({ curriculum_id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    await curriculumService.dismissCurriculum(req.body.curriculum_id, req.user!.id);
    res.json({ success: true });
  })
);

export default router;
