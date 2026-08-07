import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import * as badgesService from './badges.service';

const router = Router();

router.get(
  '/badges',
  asyncHandler(async (req, res) => {
    const badges = await badgesService.listBadges(req.user!.id);
    res.json({ badges });
  })
);

export default router;
