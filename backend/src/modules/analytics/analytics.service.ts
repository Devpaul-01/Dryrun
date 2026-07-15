import { supabaseAdmin } from '../../config/supabase';
import { posthogClient } from './posthog.client';
import { createLogger } from '../../config/logger';

const log = createLogger('analytics');

interface EventContext {
  userId?: string;
  workspaceId?: string;
  sessionId?: string;
}

/**
 * The single entry point every module uses to emit a product event.
 *
 * Dual-write strategy (architecture doc §17.2): the event is persisted to
 * `analytics_events` for internal reporting joins (e.g., correlating
 * `feature_gate_hit` with subsequent subscription conversion, which needs a
 * join against `subscriptions` in the same database) AND forwarded to
 * PostHog for day-to-day funnel/retention/cohort analysis.
 *
 * Fire-and-forget: a slow or failed write here must never block or fail the
 * user-facing request that triggered it. Callers do not (and should not)
 * `await` this in a way that gates their own response.
 */
export async function trackEvent(
  eventName: string,
  context: EventContext,
  properties: Record<string, unknown> = {}
): Promise<void> {
  // Deliberately not awaited by callers — this function itself resolves
  // quickly and swallows its own errors so it can never surface as a
  // request failure.
  try {
    await supabaseAdmin()
      .from('analytics_events')
      .insert({
        user_id: context.userId ?? null,
        workspace_id: context.workspaceId ?? null,
        session_id: context.sessionId ?? null,
        event_name: eventName,
        properties,
        occurred_at: new Date().toISOString(),
      });
  } catch (err) {
    log.warn({ err, eventName }, 'Failed to persist analytics event to Postgres');
  }

  try {
    const client = posthogClient();
    if (client) {
      client.capture({
        distinctId: context.userId ?? context.workspaceId ?? 'anonymous',
        event: eventName,
        properties: {
          ...properties,
          workspace_id: context.workspaceId,
          session_id: context.sessionId,
        },
      });
    }
  } catch (err) {
    log.warn({ err, eventName }, 'Failed to forward analytics event to PostHog');
  }
}
