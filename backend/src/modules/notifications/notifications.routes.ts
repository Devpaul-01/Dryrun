import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { fetchCursorPage } from '../../lib/cursorPagination';
import { supabaseAdmin } from '../../config/supabase';
import * as notificationsService from './notifications.service';
import * as pushService from './push.service';

const router = Router();

router.get(
  '/',
  validate({ query: z.object({ cursor: z.string().optional(), limit: z.coerce.number().max(100).optional() }) }),
  asyncHandler(async (req, res) => {
    const page = await fetchCursorPage(
      supabaseAdmin(),
      'notifications_log',
      (q) => q.select('*').eq('user_id', req.user!.id) as any,
      req.query as any
    );
    res.json(page);
  })
);

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await notificationsService.markRead(req.params.id, req.user!.id);
    res.json({ success: true });
  })
);

router.post(
  '/mark-all-read',
  asyncHandler(async (req, res) => {
    await notificationsService.markAllRead(req.user!.id);
    res.json({ success: true });
  })
);

router.post(
  '/push-token',
  validate({ body: z.object({ token: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    await pushService.registerPushToken(req.user!.id, req.body.token);
    res.json({ success: true });
  })
);

export default router;
