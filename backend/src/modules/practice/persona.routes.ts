import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { entitlement } from '../../middleware/entitlement';
import { canGeneratePersonaFromDocument } from '../billing/entitlements';
import { expensiveActionRateLimit } from '../../middleware/rateLimit';
import * as personaService from './persona.service';
import { createPersonaSchema, createPersonaFromSourceSchema, updatePersonaSchema } from './persona.schemas';
import { SCENARIO_TYPES, PRESSURE_MODIFIERS, COMMUNICATION_STYLE_PRESETS, CONVERSATION_CHANNEL_PRESETS } from './scenario.config';
import { supabaseAdmin } from '../../config/supabase';
import { fetchCursorPage } from '../../lib/cursorPagination';

const router = Router();

const listPersonasQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

router.get(
  '/scenarios',
  asyncHandler(async (req, res) => {
    res.json({
      scenario_types: SCENARIO_TYPES,
      pressure_modifiers: PRESSURE_MODIFIERS,
      communication_style_presets: COMMUNICATION_STYLE_PRESETS,
      conversation_channel_presets: CONVERSATION_CHANNEL_PRESETS,
    });
  })
);

/**
 * FIX (BACKEND_API_RECOMMENDATIONS.md finding B3): this endpoint was
 * previously capped at .limit(100) with no pagination beyond it — a
 * workspace crossing 100 reusable personas would see the list silently
 * truncate, with no next_cursor or signal anything was cut off. Now uses
 * fetchCursorPage, matching GET /sessions, GET /playbooks, and
 * GET /billing/invoices. Response shape changes from
 * `{ personas: [...] }` to `{ items: [...], next_cursor }`.
 */
router.get(
  '/personas',
  validate({ query: listPersonasQuerySchema }),
  asyncHandler(async (req, res) => {
    const page = await fetchCursorPage(
      supabaseAdmin(),
      'personas',
      (q) =>
        q
          .select('id, name, role, source_type, reusable, created_at')
          .eq('workspace_id', req.workspace!.id)
          .is('deleted_at', null) as any,
      req.query as any
    );
    res.json(page);
  })
);

router.post(
  '/personas',
  validate({ body: createPersonaSchema }),
  asyncHandler(async (req, res) => {
    const persona = await personaService.createManualPersona(req.workspace!.id, req.user!.id, req.body);
    res.status(201).json({ persona });
  })
);

router.post(
  '/personas/from-source',
  expensiveActionRateLimit,
  entitlement(canGeneratePersonaFromDocument),
  validate({ body: createPersonaFromSourceSchema }),
  asyncHandler(async (req, res) => {
    const persona = await personaService.createPersonaFromSource({
      workspaceId: req.workspace!.id,
      userId: req.user!.id,
      scenarioType: req.body.scenario_type,
      sourceKind: req.body.source_kind,
      pastedText: req.body.pasted_text,
      url: req.body.url,
      uploadId: req.body.upload_id,
    });
    res.status(202).json({ persona, message: 'Persona is being generated — subscribe to the realtime channel for status.' });
  })
);

router.get(
  '/personas/:id',
  asyncHandler(async (req, res) => {
    const persona = await personaService.getPersonaById(req.params.id, req.workspace!.id);
    res.json({ persona });
  })
);

router.patch(
  '/personas/:id',
  validate({ body: updatePersonaSchema }),
  asyncHandler(async (req, res) => {
    const persona = await personaService.updatePersona(req.params.id, req.workspace!.id, req.body);
    res.json({ persona });
  })
);

router.delete(
  '/personas/:id',
  asyncHandler(async (req, res) => {
    await personaService.deletePersona(req.params.id, req.workspace!.id);
    res.json({ success: true });
  })
);

export default router;
