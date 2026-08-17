import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/requireRole';
import * as billingService from './billing.service';
import { supabaseAdmin } from '../../config/supabase';
import { fetchCursorPage } from '../../lib/cursorPagination';

const router = Router();

const listInvoicesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    const plans = await billingService.listPlans();
    res.json({ plans });
  })
);

router.get(
  '/subscription',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const subscription = await billingService.getCurrentSubscription(req.workspace!.id);
    res.json({ subscription });
  })
);

router.post(
  '/checkout',
  requireRole('owner', 'admin'),
  validate({ body: z.object({ plan_key: z.string() }) }),
  asyncHandler(async (req, res) => {
    const checkout = await billingService.initiateCheckout(req.workspace!.id, req.body.plan_key, req.user!.email);
    res.status(201).json(checkout);
  })
);

router.get(
  '/checkout/:ref/status',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await billingService.confirmCheckout(req.workspace!.id, req.params.ref);
    res.json(result);
  })
);

router.post(
  '/cancel',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const result = await billingService.cancelSubscription(req.workspace!.id);
    res.json(result);
  })
);

router.post(
  '/add-seats',
  requireRole('owner', 'admin'),
  validate({ body: z.object({ additional_seats: z.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const result = await billingService.addSeats(req.workspace!.id, req.body.additional_seats, req.user!.id);
    res.json(result);
  })
);

/**
 * FIX (audit finding H3): this endpoint was previously fully unbounded —
 * no .limit() at all — meaning a long-lived paying workspace's invoice
 * history (monthly renewals over years) would grow without a cap or a
 * way to page through it. Moved off billing.service.ts's listInvoices()
 * and onto fetchCursorPage directly at the route layer, matching this
 * codebase's established convention (session.routes.ts, notifications.
 * routes.ts, playbook.routes.ts all paginate at this layer, not in a
 * service function) — see lib/cursorPagination.ts's own header comment,
 * which already documented "invoices" as an intended consumer of this
 * helper. Response shape changes from `{ invoices: [...] }` to
 * `{ items: [...], next_cursor }`, a deliberate breaking change made now
 * rather than after frontend code depends on the old shape.
 */
router.get(
  '/invoices',
  requireRole('owner', 'admin'),
  validate({ query: listInvoicesQuerySchema }),
  asyncHandler(async (req, res) => {
    const page = await fetchCursorPage(
      supabaseAdmin(),
      'payment_transactions',
      (q) => q.select('id, amount, currency, status, created_at').eq('workspace_id', req.workspace!.id) as any,
      req.query as any
    );
    res.json(page);
  })
);

router.get(
  '/usage',
  asyncHandler(async (req, res) => {
    const usage = await billingService.getUsage(req.workspace!.id);
    res.json({ usage });
  })
);

export default router;
