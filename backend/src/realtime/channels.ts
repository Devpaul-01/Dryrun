import { supabaseAdmin } from '../config/supabase';
import { createLogger } from '../config/logger';

const log = createLogger('realtime');

/**
 * Channel naming convention, consistent across the codebase (architecture
 * doc: "Real-Time Architecture" §, jobs/workers/*):
 *   session:{sessionId}   — debrief/scoring completion status
 *   persona:{personaId}   — persona-from-source ingestion status
 *
 * This uses Supabase Realtime's broadcast API (not postgres_changes) —
 * broadcast is the right tool for ephemeral status-transition events that
 * don't need a client to have row-level select access to see them (e.g., a
 * persona still mid-synthesis, before it's a fully valid row a client
 * would normally be allowed to read).
 */
export async function publishStatus(
  channel: 'session' | 'persona',
  entityId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const rtChannel = supabaseAdmin().channel(`${channel}:${entityId}`);
  try {
    await rtChannel.send({ type: 'broadcast', event, payload });
  } catch (err) {
    // Never let a realtime publish failure affect the underlying job's
    // success — the client's poll-on-focus fallback (architecture doc,
    // frontend platform §5.4) covers this case.
    log.warn({ err, channel, entityId, event }, 'Failed to publish realtime status update');
  } finally {
    // FIX (audit finding C3): supabase.channel() allocates a new realtime
    // channel object on every call with no automatic cleanup on the JS
    // side. This function is called on essentially every completed
    // background job in the product (debrief-ready, scoring-ready,
    // persona-status-change), so every prior call leaked. Long-running
    // worker processes (the whole start-all.ts/jobs/index.ts design
    // assumes continuous, not per-request, processes) accumulate this
    // leak without bound as event throughput grows. unsubscribe() runs in
    // `finally` so cleanup happens whether send() succeeded or failed.
    try {
      await rtChannel.unsubscribe();
    } catch (unsubErr) {
      log.warn({ unsubErr, channel, entityId, event }, 'Failed to unsubscribe realtime channel');
    }
  }
}
