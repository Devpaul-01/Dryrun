import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { supabaseAdmin } from '../../config/supabase';
import { redisConnection } from '../../config/redis';
import { getAllQueueDepths } from '../../jobs/queues';

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

/** Admin-only — full dependency check including queue depth. */
router.get(
  '/deep',
  asyncHandler(async (req, res) => {
    const queueDepths = await getAllQueueDepths();
    res.json({ status: 'ok', queues: queueDepths, timestamp: new Date().toISOString() });
  })
);

export default router;
