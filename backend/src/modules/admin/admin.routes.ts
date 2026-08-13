import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { supabaseAdmin } from '../../config/supabase';
import { setConfig } from '../../config/systemConfig';
import { getQueue, retryJob, getAllQueueDepths, QueueName } from '../../jobs/queues';
import { fetchDeadLetterPage } from '../../jobs/deadLetterPagination';

const router = Router();

const deadLetterQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

/**
 * Every route here additionally requires the caller to have an internal
 * `is_admin` flag on their user profile — enforced by requireAdmin
 * (applied at the mount point in app.ts, alongside the optional IP
 * allowlist layer per ADMIN_ALLOWLIST_IPS, architecture doc §5.17/§24).
 */

router.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const depths = await getAllQueueDepths();
    res.json({ queues: depths });
  })
);

router.get(
  '/jobs/dead-letter',
  validate({ query: deadLetterQuerySchema }),
  asyncHandler(async (req, res) => {
    const { cursor, limit } = req.query as unknown as z.infer<typeof deadLetterQuerySchema>;
    const page = await fetchDeadLetterPage((name: QueueName) => getQueue(name), { cursor, limit });
    res.json(page);
  })
);

router.post(
  '/jobs/:id/retry',
  validate({ body: z.object({ queue: z.string() }) }),
  asyncHandler(async (req, res) => {
    await retryJob(req.body.queue, req.params.id);
    res.json({ success: true });
  })
);

router.get(
  '/audit-log',
  validate({ query: z.object({ workspace_id: z.string().uuid().optional(), actor_user_id: z.string().uuid().optional(), limit: z.coerce.number().max(200).optional() }) }),
  asyncHandler(async (req, res) => {
    let query = supabaseAdmin().from('audit_log').select('*').order('created_at', { ascending: false }).limit((req.query as any).limit ?? 100);
    if ((req.query as any).workspace_id) query = query.eq('workspace_id', (req.query as any).workspace_id);
    if ((req.query as any).actor_user_id) query = query.eq('actor_user_id', (req.query as any).actor_user_id);
    const { data } = await query;
    res.json({ entries: data ?? [] });
  })
);

router.get(
  '/ai-scoring/sample',
  asyncHandler(async (req, res) => {
    const { data } = await supabaseAdmin()
      .from('ai_scoring_evaluations')
      .select('*')
      .eq('sampled_for_human_review', true)
      .order('created_at', { ascending: false })
      .limit(50);
    res.json({ evaluations: data ?? [] });
  })
);

router.patch(
  '/system-config/:key',
  validate({ body: z.object({ value: z.unknown() }) }),
  asyncHandler(async (req, res) => {
    await setConfig(req.params.key, req.body.value, req.user!.id);
    res.json({ success: true });
  })
);

router.get(
  '/workspaces/:id',
  asyncHandler(async (req, res) => {
    const { data } = await supabaseAdmin().from('workspaces').select('*, subscriptions(*)').eq('id', req.params.id).single();
    res.json({ workspace: data });
  })
);

export default router;
