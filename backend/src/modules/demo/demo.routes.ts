import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { anonymousActionRateLimit } from '../../middleware/rateLimit';
import * as demoService from './demo.service';

const router = Router();

router.post(
  '/start',
  anonymousActionRateLimit,
  validate({ body: z.object({ fingerprint: z.string().min(1).max(200), category: z.enum(['saas', 'services', 'physical_product']).optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await demoService.startDemo(req.ip ?? 'unknown', req.body.fingerprint, req.body.category ?? 'saas');
    res.status(201).json(result);
  })
);

router.post(
  '/:token/messages',
  validate({ body: z.object({ content: z.string().min(1).max(2000) }) }),
  asyncHandler(async (req, res) => {
    const result = await demoService.sendDemoMessage(req.params.token, req.body.content);
    res.json(result);
  })
);

router.post(
  '/:token/end',
  asyncHandler(async (req, res) => {
    const result = await demoService.endDemo(req.params.token);
    res.json(result);
  })
);

router.get(
  '/:token/replay',
  asyncHandler(async (req, res) => {
    const result = await demoService.getDemoReplay(req.params.token);
    res.json(result);
  })
);

router.post(
  '/:token/convert',
  validate({ body: z.object({ email: z.string().email(), password: z.string().min(8) }) }),
  asyncHandler(async (req, res) => {
    const result = await demoService.convertDemo(req.params.token, req.body.email, req.body.password);
    res.status(201).json({ ...result, message: 'Account created. Check your email to verify before logging in.' });
  })
);

export default router;
