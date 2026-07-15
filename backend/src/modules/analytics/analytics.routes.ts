import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { trackEvent } from './analytics.service';

const router = Router();

const trackSchema = z.object({
  event_name: z.string().min(1).max(100),
  properties: z.record(z.unknown()).optional().default({}),
  session_id: z.string().uuid().optional(),
});

/**
 * Accepts the smaller set of pure UI-interaction events the server has no
 * other way to observe (e.g., a landing-page CTA click before any account
 * exists). Most events in the taxonomy are server-emitted directly as a
 * consequence of a state change and never touch this endpoint.
 */
router.post(
  '/events',
  validate({ body: trackSchema }),
  asyncHandler(async (req, res) => {
    await trackEvent(
      req.body.event_name,
      { userId: req.user?.id, workspaceId: req.workspace?.id, sessionId: req.body.session_id },
      req.body.properties
    );
    res.status(202).json({ success: true });
  })
);

export default router;
