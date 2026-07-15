import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/requireRole';
import * as billingService from './billing.service';

const router = Router();

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
    const result = await billingService.addSeats(req.workspace!.id, req.body.additional_seats);
    res.json(result);
  })
);

router.get(
  '/invoices',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const invoices = await billingService.listInvoices(req.workspace!.id);
    res.json({ invoices });
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
