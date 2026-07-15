import { PostHog } from 'posthog-node';
import { env } from '../../config/env';
import { createLogger } from '../../config/logger';

const log = createLogger('posthog');

/**
 * PostHog was chosen over Mixpanel/Amplitude for three reasons specific to
 * this product's stage:
 *  1. Self-hostable later, if avoiding a third-party data processor for
 *     conversation-adjacent analytics ever becomes a compliance concern —
 *     no migration required, same SDK either way.
 *  2. Generous free tier appropriate for a pre-revenue product validating
 *     demand (architecture doc's stated priority: cost discipline at MVP).
 *  3. A clean, minimal Node SDK that fits the "fire-and-forget, never block
 *     the request" event-emission pattern the architecture already assumes
 *     (analytics.service.ts wraps this client so a PostHog outage never
 *     fails or delays the request that triggered the event).
 */
let _client: PostHog | null = null;

export function posthogClient(): PostHog | null {
  if (!env.posthog.apiKey) {
    return null; // analytics forwarding is a no-op if not configured (e.g. local dev)
  }
  if (!_client) {
    _client = new PostHog(env.posthog.apiKey, { host: env.posthog.host, flushAt: 20, flushInterval: 5000 });
  }
  return _client;
}

export async function shutdownPostHog(): Promise<void> {
  if (_client) {
    await _client.shutdown();
  }
}

export function logPostHogUnavailable(): void {
  log.debug('PostHog not configured — analytics events will be persisted to Postgres only.');
}
