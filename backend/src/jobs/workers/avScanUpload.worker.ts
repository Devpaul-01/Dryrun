import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { scanBuffer } from '../../modules/files/avScan.service';
import { STORAGE_BUCKET } from '../../modules/files/upload.service';
import { enqueue } from '../queues';
import { createLogger } from '../../config/logger';

const log = createLogger('av-scan-worker');

export async function avScanUploadHandler(job: Job<{ uploadId: string; workspaceId: string }>): Promise<void> {
  const { uploadId, workspaceId } = job.data;

  const { data: upload } = await supabaseAdmin().from('uploads').select('*').eq('id', uploadId).single();
  if (!upload) return;

  const { data: fileData, error } = await supabaseAdmin().storage.from(STORAGE_BUCKET).download(upload.storage_path);
  if (error || !fileData) {
    log.error({ uploadId, error }, 'Failed to download upload for AV scan');
    await supabaseAdmin().from('uploads').update({ status: 'failed', av_scan_status: 'flagged' }).eq('id', uploadId);
    return;
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  const scanResult = await scanBuffer(buffer);

  if (!scanResult.clean) {
    await supabaseAdmin().from('uploads').update({ status: 'failed', av_scan_status: 'flagged' }).eq('id', uploadId);
    await supabaseAdmin().storage.from(STORAGE_BUCKET).remove([upload.storage_path]);
    log.warn({ uploadId, reason: scanResult.reason }, 'Upload rejected by AV scan — object deleted from storage');
    return;
  }

  await supabaseAdmin().from('uploads').update({ av_scan_status: 'clean' }).eq('id', uploadId);

  if (upload.purpose === 'persona_source') {
    // The corresponding persona_sources row is created by the route/service
    // that initiated the persona-from-source flow; find and enqueue extraction.
    //
    // FIX (audit finding C1a): this enqueue previously omitted scenarioType
    // entirely, since this generic upload-completion worker has no
    // persona-specific context of its own. scenario_type is now read
    // directly off the persona_sources row (set at creation time by
    // persona.service.ts's createPersonaFromSource) rather than threaded
    // through the upload pipeline's job payload — see
    // db/migrations/0001_persona_sources_scenario_type.sql. This avoids
    // coupling the generic upload system to persona-specific fields while
    // still closing the gap: every upload-originated persona previously
    // synthesized with an undefined scenario type.
    const { data: source } = await supabaseAdmin()
      .from('persona_sources')
      .select('id, persona_id, scenario_type')
      .eq('raw_reference', uploadId)
      .maybeSingle();
    if (source) {
      await enqueue('persona-ingestion', 'extract_persona_source', {
        personaId: source.persona_id,
        personaSourceId: source.id,
        workspaceId,
        scenarioType: source.scenario_type ?? undefined,
        sourceKind: 'upload',
      });
    }
  } else {
    await supabaseAdmin().from('uploads').update({ status: 'processed' }).eq('id', uploadId);
  }
}
