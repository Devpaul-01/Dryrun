import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { trackEvent } from './analytics.service';

const router = Router();

const trackSchema = z.object({
  event_name: z.string().min(1).max(100),
  properties: z.record(z.string(), z.unknown()).optional().default({}),
  session_id: z.string().uuid().optional(),
});

/**
 * Accepts the smaller set of pure UI-interaction events the server has no
 * other way to observe (e.g. which onboarding step a user abandoned on,
 * a button click that doesn't itself cause a state change). Most events
 * in the taxonomy are server-emitted directly as a consequence of a state
 * change and never touch this endpoint.
 *
 * FIX (found during the backend-takeover mobile-readiness review): this
 * comment used to describe accepting "a landing-page CTA click before
 * any account exists," but that was never actually true — this route is
 * mounted behind the same `authed` chain as every other authenticated
 * route (app.ts), so authenticate.ts rejects any request with no bearer
 * token before this handler ever runs. There is no unauthenticated
 * tracking path here, and none was needed: the pre-account funnel
 * (demo_started, demo_message_sent, demo_completed,
 * demo_converted — demo.service.ts) is already covered by direct,
 * server-side trackEvent() calls from the unauthenticated demo routes,
 * which don't go through this endpoint at all. If a genuinely
 * unauthenticated client-side event is ever needed, it has to be its own
 * route mounted outside `authed`, not this one.
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
