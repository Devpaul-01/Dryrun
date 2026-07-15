import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { createLogger } from '../../config/logger';

const log = createLogger('purge-demo-sessions-worker');

/** Naturally idempotent — deletes rows past expires_at; safe to re-run. */
export async function purgeExpiredDemoSessionsHandler(_job: Job): Promise<void> {
  const { error, count } = await supabaseAdmin()
    .from('demo_sessions')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString());

  if (error) {
    log.error({ error }, 'Failed to purge expired demo sessions');
    return;
  }
  if (count) log.info({ count }, 'Purged expired demo sessions');
}
