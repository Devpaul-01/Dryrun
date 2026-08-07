import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { createLogger } from '../../config/logger';
import { verifyAndParseEmailHookPayload, handleEmailHookPayload } from './emailHook.service';

const log = createLogger('email-hook-route');

/**
 * MOUNTING REQUIREMENT — read before moving this route:
 *
 * This router MUST be mounted in app.ts with its own `express.raw()` body
 * parser, and that mount MUST occur BEFORE the global `express.json()`
 * middleware runs. Signature verification (emailHook.service.ts's
 * `standardwebhooks` check) computes an HMAC over the exact raw request
 * body bytes — once Express's global JSON parser has consumed and
 * re-parsed the body, those original bytes are gone, and re-serializing
 * `req.body` with `JSON.stringify` does NOT reliably reproduce byte-for-
 * byte the same string Supabase signed (whitespace/key-order can differ),
 * so verification would fail unpredictably. This is a different situation
 * from modules/billing/webhook.routes.ts's Flutterwave handler, which
 * checks a static pre-shared hash rather than an HMAC-over-body and so
 * doesn't have this constraint — do not use that file as a template for
 * how this one is mounted.
 *
 * See app.ts's mount point (before the `express.json()` line) for the
 * actual `express.raw({ type: 'application/json' })` wiring.
 */
const router = Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    // req.body is a Buffer here (express.raw()'s output) — NOT yet
    // parsed JSON, by design (see the mounting-requirement comment above).
    const rawBody: Buffer = req.body;
    const headers = req.headers as Record<string, string>;

    try {
      const payload = verifyAndParseEmailHookPayload(rawBody, headers);
      await handleEmailHookPayload(payload);
      log.info({ actionType: payload.email_data.email_action_type }, 'Send Email Hook processed successfully');
    } catch (err) {
      log.error({ err }, 'Send Email Hook processing failed — Supabase will not retry this delivery');
      throw err;
    }

    // Per Supabase's Send Email Hook contract: no response body required,
    // an empty 200 is a successful response.
    res.status(200).json({});
  })
);

export default router;
