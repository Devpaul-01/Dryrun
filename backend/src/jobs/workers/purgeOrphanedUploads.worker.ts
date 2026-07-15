import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { STORAGE_BUCKET } from '../../modules/files/upload.service';
import { createLogger } from '../../config/logger';

const log = createLogger('purge-orphaned-uploads-worker');
const ORPHAN_TTL_HOURS = 24;

/** Uploads that got a signed URL but were never confirmed complete. */
export async function purgeOrphanedUploadsHandler(_job: Job): Promise<void> {
  const cutoff = new Date(Date.now() - ORPHAN_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const { data: orphans } = await supabaseAdmin()
    .from('uploads')
    .select('id, storage_path')
    .eq('status', 'uploaded')
    .lt('created_at', cutoff);

  for (const orphan of orphans ?? []) {
    await supabaseAdmin().storage.from(STORAGE_BUCKET).remove([orphan.storage_path]).catch(() => {});
    await supabaseAdmin().from('uploads').delete().eq('id', orphan.id);
  }

  if (orphans?.length) log.info({ count: orphans.length }, 'Purged orphaned uploads');
}
