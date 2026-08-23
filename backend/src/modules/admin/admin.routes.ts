import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { supabaseAdmin } from '../../config/supabase';
import { setConfig } from '../../config/systemConfig';
import { getQueue, retryJob, getAllQueueDepths, QueueName } from '../../jobs/queues';
import { fetchDeadLetterPage } from '../../jobs/deadLetterPagination';
import { adminActionRateLimit } from '../../middleware/rateLimit';
import { ApiError } from '../../lib/apiError';
import * as billingService from '../billing/billing.service';
import { fetchCursorPage } from '../../lib/cursorPagination';

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
  adminActionRateLimit,
  validate({ body: z.object({ queue: z.string() }) }),
  asyncHandler(async (req, res) => {
    await retryJob(req.body.queue, req.params.id);
    res.json({ success: true });
  })
);

/**
 * FIX (MED-12): this used to be a flat query with a hard `.limit()` and
 * no cursor — once a workspace/deployment accumulated more entries than
 * that limit, there was no way to page back through older history at
 * all. Converted to the same cursor-pagination pattern used everywhere
 * else in this codebase. Response shape changes from `{ entries: [...] }`
 * to `{ items: [...], next_cursor }`.
 */
router.get(
  '/audit-log',
  validate({
    query: z.object({
      cursor: z.string().optional(),
      workspace_id: z.string().uuid().optional(),
      actor_user_id: z.string().uuid().optional(),
      limit: z.coerce.number().max(200).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { cursor, workspace_id, actor_user_id, limit } = req.query as any;
    const page = await fetchCursorPage(
      supabaseAdmin(),
      'audit_log',
      (q) => {
        let query = q.select('*');
        if (workspace_id) query = query.eq('workspace_id', workspace_id);
        if (actor_user_id) query = query.eq('actor_user_id', actor_user_id);
        return query as any;
      },
      { cursor, limit }
    );
    res.json(page);
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
  adminActionRateLimit,
  validate({ body: z.object({ value: z.unknown() }) }),
  asyncHandler(async (req, res) => {
    await setConfig(req.params.key, req.body.value, req.user!.id);
    res.json({ success: true });
  })
);

router.get(
  '/workspaces/:id',
  asyncHandler(async (req, res) => {
    const { data, error } = await supabaseAdmin().from('workspaces').select('*, subscriptions(*)').eq('id', req.params.id).single();
    if (error || !data) throw ApiError.notFound('Workspace not found.');
    res.json({ workspace: data });
  })
);

/**
 * FIX (HIGH-4): provider.refund() existed on the payment-provider
 * interface and by the Flutterwave provider, but was never called from
 * anywhere in the application — see billing.service.ts#refundSubscriptionPayment
 * for the full rationale and scope.
 */
router.post(
  '/subscriptions/:id/refund',
  adminActionRateLimit,
  asyncHandler(async (req, res) => {
    const result = await billingService.refundSubscriptionPayment(req.params.id, req.user!.id);
    res.json(result);
  })
);

export default router;
