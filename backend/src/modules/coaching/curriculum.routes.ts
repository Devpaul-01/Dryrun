import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import * as curriculumService from './curriculum.service';

const router = Router();

router.get(
  '/curriculum/current',
  asyncHandler(async (req, res) => {
    const curriculum = await curriculumService.getCurrentCurriculum(req.user!.id, req.workspace!.id);
    res.json({ curriculum });
  })
);

router.post(
  '/curriculum/dismiss',
  validate({ body: z.object({ curriculum_id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    await curriculumService.dismissCurriculum(req.body.curriculum_id, req.user!.id);
    res.json({ success: true });
  })
);

export default router;
