import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { uploadRateLimit } from '../../middleware/rateLimit';
import * as uploadService from './upload.service';

const router = Router();

const signedUrlSchema = z.object({
  purpose: z.enum(['persona_source', 'session_context']),
  filename: z.string().min(1).max(255),
  mime_type: z.string(),
  size_bytes: z.number().int().positive(),
});

/**
 * One-by-one signed-URL issuance — the natural building block. A client
 * uploading multiple files (e.g., multiple attachments in one message)
 * simply calls this endpoint once per file and gathers the resulting
 * upload_ids before calling POST /sessions/:id/attachments with all of
 * them together. This is what "support both single and multiple uploads
 * without forcing bulk-only" means in practice — there is no separate
 * bulk-upload endpoint to keep in sync with the single-file path; multiple
 * uploads are just several single uploads composed by the client.
 */
router.post(
  '/signed-url',
  uploadRateLimit,
  validate({ body: signedUrlSchema }),
  asyncHandler(async (req, res) => {
    const result = await uploadService.createSignedUploadUrl({
      workspaceId: req.workspace!.id,
      userId: req.user!.id,
      ...req.body,
    });
    res.status(201).json(result);
  })
);

router.post(
  '/:id/complete',
  uploadRateLimit,
  asyncHandler(async (req, res) => {
    const result = await uploadService.completeUpload(req.params.id, req.workspace!.id, req.user!.id);
    res.json(result);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const upload = await uploadService.getUpload(req.params.id, req.workspace!.id, req.user!.id);
    res.json({ upload });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await uploadService.deleteUpload(req.params.id, req.workspace!.id, req.user!.id);
    res.json({ success: true });
  })
);

export default router;
