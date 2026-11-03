import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { extractTextFromPdf, extractTextFromDocx, extractTextFromUrl, extractTextFromImage } from '../../modules/files/extraction.service';
import { STORAGE_BUCKET } from '../../modules/files/upload.service';
import { publishStatus } from '../../realtime/channels';
import { enqueue } from '../queues';
import { createLogger } from '../../config/logger';

const log = createLogger('extract-persona-source-worker');

const PII_PATTERN = /@[\w.-]+\.\w+|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/; // email or phone-like patterns

export async function extractPersonaSourceHandler(
  job: Job<{ personaId: string; personaSourceId: string; workspaceId: string; scenarioType?: string; sourceKind: string }>
): Promise<void> {
  const { personaId, personaSourceId, workspaceId, sourceKind } = job.data;

  const { data: source } = await supabaseAdmin().from('persona_sources').select('*').eq('id', personaSourceId).single();
  if (!source) return;

  // Prefer the durable scenario_type stored on the persona_sources row
  // itself (set at creation time by persona.service.ts) over the job
  // payload's copy — this is the source of truth the DB-lookup design in
  // audit finding C1a moved to, so a value on the row always wins. Falling
  // back to job.data.scenarioType covers a persona_sources row written
  // before src/db/migrations/0008_persona_sources_scenario_type.sql landed,
  // where the column will be null but the payload (on the pasted_text/url
  // paths, which always carried this field correctly) may still have it.
  const scenarioType = source.scenario_type ?? job.data.scenarioType ?? '';

  try {
    let extractedText = '';

    if (sourceKind === 'url') {
      extractedText = await extractTextFromUrl(source.raw_reference);
    } else if (sourceKind === 'upload') {
      const { data: upload } = await supabaseAdmin().from('uploads').select('*').eq('id', source.raw_reference).maybeSingle();
      if (!upload) throw new Error('Referenced upload not found');
      const { data: fileData } = await supabaseAdmin().storage.from(STORAGE_BUCKET).download(upload.storage_path);
      if (!fileData) throw new Error('Failed to download upload');
      const buffer = Buffer.from(await fileData.arrayBuffer());

      if (upload.mime_type === 'application/pdf') extractedText = await extractTextFromPdf(buffer);
      else if (upload.mime_type.includes('word')) extractedText = await extractTextFromDocx(buffer);
      else if (upload.mime_type.startsWith('image/')) extractedText = await extractTextFromImage(buffer);
      else extractedText = buffer.toString('utf8').slice(0, 20000);

      // FIX (found during the backend-takeover upload-pipeline review):
      // avScanUpload.worker.ts sets uploads.status: 'processed' for every
      // OTHER upload purpose once the AV scan passes, but for
      // purpose: 'persona_source' it deliberately leaves status alone and
      // hands off to this worker instead (see that file's own comment).
      // This worker, however, never picked up that handoff — it updates
      // persona_sources.status on both success and failure below, but
      // never touched the underlying uploads row at all, leaving it
      // stuck at 'processing' forever even after extraction fully
      // succeeded. Harmless for purgeOrphanedUploads.worker.ts (which
      // only targets status: 'uploaded', so this never caused data
      // loss), but GET /uploads/:id — the endpoint a client polls to
      // show upload progress — would never report anything past
      // "processing" for a persona-source upload, however long the
      // extraction has been enqueued or finished. Now finalized here,
      // matching the non-persona-source branch's own convention.
      await supabaseAdmin().from('uploads').update({ status: 'processed' }).eq('id', upload.id);
    }

    const containsFlaggedPii = source.source_kind === 'pasted_text' ? false : PII_PATTERN.test(extractedText);

    await supabaseAdmin()
      .from('persona_sources')
      .update({ extracted_text: extractedText, status: 'extracted', contains_flagged_pii: containsFlaggedPii })
      .eq('id', personaSourceId);

    await publishStatus('persona', personaId, 'extracted', { personaId });
    await enqueue('persona-ingestion', 'synthesize_persona', { personaId, personaSourceId, workspaceId, scenarioType });
  } catch (err) {
    log.error({ err, personaSourceId }, 'Persona source extraction failed');
    await supabaseAdmin().from('persona_sources').update({ status: 'extraction_failed' }).eq('id', personaSourceId);
    if (sourceKind === 'upload') {
      // Same reasoning as the success path above — finalize the upload
      // row's status rather than leaving it stuck at 'processing'
      // indefinitely after a definitive, non-retryable failure.
      await supabaseAdmin().from('uploads').update({ status: 'failed' }).eq('id', source.raw_reference);
    }
    await publishStatus('persona', personaId, 'extraction_failed', {
      personaId,
      message: 'We could not process that source. Try pasting the text directly instead.',
    });
  }
}
