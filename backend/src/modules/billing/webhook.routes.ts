import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { webhookRateLimit } from '../../middleware/rateLimit';
import { supabaseAdmin } from '../../config/supabase';
import { flutterwaveProvider } from './providers/flutterwave.provider';
import { enqueue } from '../../jobs/queues';
import { createLogger } from '../../config/logger';

const log = createLogger('webhook-routes');
const router = Router();

/**
 * Full flow per architecture doc §14.3:
 *  1. verify signature — failures logged separately and spike-monitored
 *  2. log raw payload to webhook_events BEFORE any business logic
 *  3. respond 200 immediately, independent of downstream processing
 *  4. hand off to the billing queue for idempotent processing
 */
router.post(
  '/flutterwave',
  webhookRateLimit,
  asyncHandler(async (req, res) => {
    const signature = req.headers['verif-hash'] as string | undefined;
    const isValid = flutterwaveProvider.verifyWebhookSignature(JSON.stringify(req.body), signature);

    if (!isValid) {
      await supabaseAdmin().from('webhook_signature_failures').insert({
        source_ip: req.ip,
        raw_headers: req.headers as Record<string, unknown>,
      });
      await checkSignatureFailureSpike();
      log.warn({ ip: req.ip }, 'Webhook signature verification failed');
      res.status(401).json({ error: 'INVALID_SIGNATURE' });
      return;
    }

    const providerEventId = req.body?.data?.id ? String(req.body.data.id) : `${Date.now()}`;

    const { data: eventRow, error } = await supabaseAdmin()
      .from('webhook_events')
      .insert({
        provider: 'flutterwave',
        provider_event_id: providerEventId,
        event_type: req.body?.event ?? 'unknown',
        payload: req.body,
        processed: false,
        signature_verified: true,
      })
      .select('id')
      .single();

    if (error) {
      // Unique constraint violation on provider_event_id = duplicate delivery.
      // Still respond 200 so the provider doesn't retry indefinitely.
      log.info({ providerEventId }, 'Duplicate webhook delivery, ignoring');
      res.status(200).json({ received: true });
      return;
    }

    res.status(200).json({ received: true });
    await enqueue('billing', 'process_webhook_event', { webhookEventId: eventRow.id });
  })
);

async function checkSignatureFailureSpike(): Promise<void> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin()
    .from('webhook_signature_failures')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', fiveMinutesAgo);

  if ((count ?? 0) > 10) {
    log.error({ count }, 'ALERT: webhook signature failure spike detected — possible spoofing attempt');
    // Wired to the single consolidated alert channel in production
    // (architecture doc §18) — a Slack/Discord webhook call would go here.
  }
}

export default router;
