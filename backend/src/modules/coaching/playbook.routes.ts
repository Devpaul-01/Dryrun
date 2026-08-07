import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { entitlement } from '../../middleware/entitlement';
import { canGeneratePlaybook } from '../billing/entitlements';
import { expensiveActionRateLimit } from '../../middleware/rateLimit';
import { withIdempotency } from '../../lib/idempotency';
import * as playbookService from './playbook.service';
import { supabaseAdmin } from '../../config/supabase';

/**
 * Split out of the original coaching.routes.ts (item #14, router
 * refactoring) — playbooks, badges, skill-trend, and curriculum were four
 * genuinely distinct sub-concerns bundled into one 176-line file. All
 * four split files are still mounted under the same /api/v1 prefix in
 * app.ts, so the public route paths are unchanged; this is purely an
 * internal file-organization change.
 */
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

export default router;

/** Public, unauthenticated — mounted separately in app.ts under /public. */
export const publicPlaybookRouter = Router();
publicPlaybookRouter.get(
  '/playbooks/:token',
  asyncHandler(async (req, res) => {
    const playbook = await playbookService.getPublicPlaybook(req.params.token);
    res.json({ playbook });
  })
);
