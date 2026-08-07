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
  job: Job<{ personaId: string; personaSourceId: string; workspaceId: string; userId?: string; scenarioType: string; sourceKind: string }>
): Promise<void> {
  const { personaId, personaSourceId, workspaceId, userId, scenarioType, sourceKind } = job.data;

  const { data: source } = await supabaseAdmin().from('persona_sources').select('*').eq('id', personaSourceId).single();
  if (!source) return;

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
      else if (upload.mime_type.startsWith('image/')) extractedText = await extractTextFromImage(buffer, upload.mime_type);
      else extractedText = buffer.toString('utf8').slice(0, 20000);
    }

    const containsFlaggedPii = source.source_kind === 'pasted_text' ? false : PII_PATTERN.test(extractedText);

    await supabaseAdmin()
      .from('persona_sources')
      .update({ extracted_text: extractedText, status: 'extracted', contains_flagged_pii: containsFlaggedPii })
      .eq('id', personaSourceId);

    await publishStatus('persona', personaId, 'extracted', { personaId });
    await enqueue('persona-ingestion', 'synthesize_persona', { personaId, personaSourceId, workspaceId, userId, scenarioType });
  } catch (err) {
    log.error({ err, personaSourceId }, 'Persona source extraction failed');
    await supabaseAdmin().from('persona_sources').update({ status: 'extraction_failed' }).eq('id', personaSourceId);
    await publishStatus('persona', personaId, 'extraction_failed', {
      personaId,
      message: 'We could not process that source. Try pasting the text directly instead.',
    });
  }
}
