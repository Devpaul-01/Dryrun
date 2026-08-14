import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { enqueue } from '../../jobs/queues';
import { exportRateLimit } from '../../middleware/rateLimit';

const router = Router();

router.get(
  '/export',
  exportRateLimit,
  asyncHandler(async (req, res) => {
    const jobId = await enqueue('maintenance', 'export_user_data', { userId: req.user!.id });
    res.status(202).json({ job_id: jobId, message: 'Your export is being prepared. You will be notified when it is ready.' });
  })
);

export default router;
