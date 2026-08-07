import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { entitlement } from '../../middleware/entitlement';
import { canStartSession } from '../billing/entitlements';
import { messageRateLimit } from '../../middleware/rateLimit';
import { fetchCursorPage } from '../../lib/cursorPagination';
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import * as sessionService from './session.service';
import * as debriefService from '../coaching/debrief.service';
import { createSessionSchema, sendMessageSchema, renameSessionSchema, listSessionsQuerySchema, messagesQuerySchema, attachmentsSchema } from './session.schemas';
import { cached, cacheKeys, cacheTags, CACHE_TTL } from '../../config/cache';
import { fetchMessagesPage } from '../../lib/messagesPagination';

const router = Router();

router.post(
  '/',
  entitlement(canStartSession),
  validate({ body: createSessionSchema }),
  asyncHandler(async (req, res) => {
    const session = await sessionService.createSession({
      userId: req.user!.id,
      workspaceId: req.workspace!.id,
      scenarioType: req.body.scenario_type,
      pressureModifiers: req.body.pressure_modifiers,
      difficultyOverride: req.body.difficulty_override,
      personaId: req.body.persona_id,
      goal: req.body.goal ? { goalType: req.body.goal.goal_type, customText: req.body.goal.custom_text } : undefined,
    });
    res.status(201).json({ session });
  })
);

router.get(
  '/',
  validate({ query: listSessionsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { cursor, limit, archived, scenario_type, search } = req.query as unknown as z.infer<typeof listSessionsQuerySchema>;

    // Cache only the common "just opened the list" shape: no cursor, no
    // search, no scenario filter, default limit. Any filter/pagination
    // beyond that is cheap enough uncached and combinatorially unbounded
    // (search text especially) — not worth a cache key per filter combo.
    const isCacheableFirstPage = !cursor && !scenario_type && !search;

    const fetchPage = () =>
      fetchCursorPage(
        supabaseAdmin(),
        'practice_sessions',
        (q) => {
          let query = q
            .select('id, title, scenario_type, status, archived_at, created_at, completed_at')
            .eq('user_id', req.user!.id)
            .eq('workspace_id', req.workspace!.id);
          query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
          if (scenario_type) query = query.eq('scenario_type', scenario_type);
          if (search) query = query.textSearch('search_vector', search);
          return query as any;
        },
        { cursor, limit }
      );

    const page = isCacheableFirstPage
      ? await cached(
          cacheKeys.sessionsFirstPage(req.workspace!.id, req.user!.id, !!archived),
          { ttlSeconds: CACHE_TTL.LIST_MINUTES_2, tags: [cacheTags.sessionsUserWorkspace(req.workspace!.id, req.user!.id)] },
          fetchPage
        )
      : await fetchPage();

    res.json(page);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const session = await sessionService.getSessionById(req.params.id, req.workspace!.id);
    res.json({ session });
  })
);

router.patch(
  '/:id',
  validate({ body: renameSessionSchema }),
  asyncHandler(async (req, res) => {
    const session = await sessionService.renameSession(req.params.id, req.workspace!.id, req.user!.id, req.body.title);
    res.json({ session });
  })
);

router.post(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    await sessionService.setArchived(req.params.id, req.workspace!.id, req.user!.id, true);
    res.json({ success: true });
  })
);

router.post(
  '/:id/unarchive',
  asyncHandler(async (req, res) => {
    await sessionService.setArchived(req.params.id, req.workspace!.id, req.user!.id, false);
    res.json({ success: true });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await sessionService.deleteSession(req.params.id, req.workspace!.id, req.user!.id);
    res.json({ success: true });
  })
);

// Deliberately absent, by design (architecture doc §9.2):
//   PATCH /sessions/:id/messages/:messageId          (edit message)
//   POST  /sessions/:id/messages/:messageId/regenerate (regenerate response)
// Both were explicitly rejected — they would let a user retroactively
// rewrite what was actually said, undermining the honest-practice-record
// value the whole coaching/debrief/skill-trend system depends on.

router.post(
  '/:id/messages',
  messageRateLimit,
  validate({ body: sendMessageSchema }),
  asyncHandler(async (req, res) => {
    const result = await sessionService.sendMessage({
      sessionId: req.params.id,
      workspaceId: req.workspace!.id,
      userId: req.user!.id,
      content: req.body.content,
      attachmentUploadIds: req.body.attachment_upload_ids,
    });
    res.json(result);
  })
);

router.get(
  '/:id/messages',
  validate({ query: messagesQuerySchema }),
  asyncHandler(async (req, res) => {
    await sessionService.getSessionById(req.params.id, req.workspace!.id); // 404s if not found/owned
    const { cursor, limit } = req.query as unknown as z.infer<typeof messagesQuerySchema>;

    // Deliberately NOT cached: an active session's messages change on
    // every sendMessage() turn (two new rows per turn), which would mean
    // invalidating this on the hottest write path in the product for a
    // read that's already a cheap indexed query
    // (idx_session_messages_session_seq). Pagination is the actual fix
    // for "don't load the whole transcript every time" — a cache would
    // add invalidation surface without solving a real cost problem here.
    const page = await fetchMessagesPage(
      supabaseAdmin(),
      req.params.id,
      { cursor, limit },
      'id, role, content, sequence_index, created_at'
    );
    res.json(page);
  })
);

router.post(
  '/:id/end',
  asyncHandler(async (req, res) => {
    const result = await sessionService.endSession(req.params.id, req.workspace!.id, req.user!.id);
    res.json(result);
  })
);

router.post(
  '/:id/continue',
  asyncHandler(async (req, res) => {
    const result = await sessionService.continueSession(req.params.id, req.workspace!.id, req.user!.id);
    res.json(result);
  })
);

router.get(
  '/:id/debrief',
  asyncHandler(async (req, res) => {
    const debrief = await debriefService.getDebrief(req.params.id, req.workspace!.id);
    res.json({ debrief });
  })
);

router.get(
  '/:id/replay',
  asyncHandler(async (req, res) => {
    const replay = await debriefService.getReplay(req.params.id, req.workspace!.id, req.user!.id);
    res.json(replay);
  })
);

const exportQuerySchema = z.object({
  format: z.enum(['json', 'text']).optional().default('json'),
});

/**
 * Exports one session's full transcript, persona, goal, debrief, and
 * skill scores. Synchronous (unlike GET /user/export's queued full-
 * account export) since a single session's data is small and the user is
 * actively waiting on it. `?format=text` returns a plain-text transcript
 * with a Content-Disposition download header; the default `json` returns
 * the structured payload as a normal API response (no download header —
 * left to the frontend to decide whether to trigger a file save).
 */
router.get(
  '/:id/export',
  validate({ query: exportQuerySchema }),
  asyncHandler(async (req, res) => {
    const { format } = req.query as unknown as z.infer<typeof exportQuerySchema>;
    const payload = await debriefService.exportSessionData(req.params.id, req.workspace!.id, req.user!.id);

    if (format === 'text') {
      const text = debriefService.renderSessionExportAsText(payload);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="session-${req.params.id}.txt"`);
      res.send(text);
      return;
    }

    res.setHeader('Content-Disposition', `attachment; filename="session-${req.params.id}.json"`);
    res.json(payload);
  })
);

router.post(
  '/:id/retry',
  entitlement(canStartSession),
  asyncHandler(async (req, res) => {
    const retry = await sessionService.retrySession(req.params.id, req.workspace!.id, req.user!.id);
    res.status(201).json({ session: retry });
  })
);

router.get(
  '/:id/comparison',
  asyncHandler(async (req, res) => {
    const { data: retrySession } = await supabaseAdmin()
      .from('practice_sessions')
      .select('id, retry_of_session_id')
      .eq('id', req.params.id)
      .eq('workspace_id', req.workspace!.id)
      .single();
    if (!retrySession?.retry_of_session_id) {
      throw ApiError.badRequest('This session is not a retry of another session.');
    }
    const { data: comparison } = await supabaseAdmin()
      .from('session_retries')
      .select('comparison')
      .eq('retry_session_id', req.params.id)
      .maybeSingle();
    res.json({ comparison: comparison?.comparison ?? null });
  })
);

router.post(
  '/:id/goal',
  validate({
    body: z.object({ goal_type: z.string(), custom_text: z.string().max(300).optional() }),
  }),
  asyncHandler(async (req, res) => {
    await supabaseAdmin().from('session_goals').upsert(
      { session_id: req.params.id, goal_type: req.body.goal_type, custom_text: req.body.custom_text ?? null },
      { onConflict: 'session_id' }
    );
    res.json({ success: true });
  })
);

router.post(
  '/:id/attachments',
  validate({ body: attachmentsSchema }),
  asyncHandler(async (req, res) => {
    const session = await sessionService.getSessionById(req.params.id, req.workspace!.id);
    if (session.status !== 'active') throw ApiError.conflict('Attachments can only be added to an active session.');

    // Attach to a lightweight system message marking the share point in the
    // transcript, so replay can show exactly when a file was shared.
    const { data: marker } = await supabaseAdmin()
      .from('session_messages')
      .insert({
        session_id: req.params.id,
        role: 'system',
        content: 'Attachment shared.',
        sequence_index: await (async () => {
          const { count } = await supabaseAdmin()
            .from('session_messages')
            .select('id', { count: 'exact', head: true })
            .eq('session_id', req.params.id);
          return count ?? 0;
        })(),
      })
      .select('id')
      .single();

    await supabaseAdmin()
      .from('session_message_attachments')
      .insert(req.body.upload_ids.map((uploadId: string) => ({ message_id: marker!.id, upload_id: uploadId })));

    res.status(201).json({ success: true });
  })
);

router.get(
  '/:id/attachments',
  asyncHandler(async (req, res) => {
    const { data } = await supabaseAdmin()
      .from('session_message_attachments')
      .select('upload_id, message_id, uploads(original_filename, mime_type, size_bytes)')
      .in(
        'message_id',
        (
          await supabaseAdmin().from('session_messages').select('id').eq('session_id', req.params.id)
        ).data?.map((m) => m.id) ?? []
      );
    res.json({ attachments: data ?? [] });
  })
);

export default router;
