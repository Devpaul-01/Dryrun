import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { supabaseAdmin } from '../../config/supabase';
import { redisConnection } from '../../config/redis';
import { getAllQueueDepths } from '../../jobs/queues';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';

const router = Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

router.get(
  '/ready',
  asyncHandler(async (req, res) => {
    const checks: Record<string, boolean> = {};

    try {
      await supabaseAdmin().from('plans').select('id').limit(1);
      checks.database = true;
    } catch {
      checks.database = false;
    }

    try {
      await redisConnection().ping();
      checks.redis = true;
    } catch {
      checks.redis = false;
    }

    const allHealthy = Object.values(checks).every(Boolean);
    res.status(allHealthy ? 200 : 503).json({ status: allHealthy ? 'ready' : 'degraded', checks });
  })
);

/**
 * Admin-only — full dependency check including queue depth.
 *
 * FIX (audit finding M5): this comment previously claimed admin-only
 * access while nothing actually enforced it — the entire health.routes.ts
 * router is mounted at /health in app.ts with no auth middleware at all
 * (deliberately, since / and /ready are load-balancer/orchestration health
 * checks that must stay reachable without credentials). That meant
 * /health/deep — which returns live per-queue job counts
 * (waiting/active/failed/delayed) — was reachable by anyone, unauthenticated,
 * despite its own comment saying otherwise. Gated here at the individual
 * route level (not the router mount point, which would incorrectly also
 * lock down / and /ready) with the same authenticate + requireAdmin pair
 * admin.routes.ts uses — requireAdmin depends on authenticate having
 * already populated req.user, so both are required, in this order.
 */
router.get(
  '/deep',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const queueDepths = await getAllQueueDepths();
    res.json({ status: 'ok', queues: queueDepths, timestamp: new Date().toISOString() });
  })
);

export default router;
