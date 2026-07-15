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
  try {
    const rtChannel = supabaseAdmin().channel(`${channel}:${entityId}`);
    await rtChannel.send({ type: 'broadcast', event, payload });
  } catch (err) {
    // Never let a realtime publish failure affect the underlying job's
    // success — the client's poll-on-focus fallback (architecture doc,
    // frontend platform §5.4) covers this case.
    log.warn({ err, channel, entityId, event }, 'Failed to publish realtime status update');
  }
}
