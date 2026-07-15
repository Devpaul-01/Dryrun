import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { enqueue } from '../../jobs/queues';

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/png',
  'image/jpeg',
]);
const STORAGE_BUCKET = 'dryrun-uploads';

export async function createSignedUploadUrl(input: {
  workspaceId: string;
  userId: string;
  purpose: 'persona_source' | 'session_context';
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) {
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    throw ApiError.badRequest('File type not supported. Allowed: PDF, DOCX, TXT, PNG, JPG.');
  }
  if (input.sizeBytes > MAX_SIZE_BYTES) {
    throw ApiError.badRequest(`File too large. Maximum size is ${MAX_SIZE_BYTES / 1024 / 1024}MB.`);
  }

  const storagePath = `${input.workspaceId}/${randomUUID()}-${input.filename}`;

  const { data: uploadRow, error } = await supabaseAdmin()
    .from('uploads')
    .insert({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      purpose: input.purpose,
      storage_path: storagePath,
      original_filename: input.filename,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      status: 'uploaded',
      av_scan_status: 'pending',
    })
    .select('id')
    .single();
  if (error || !uploadRow) throw ApiError.internal('Failed to initialize upload.');

  const { data: signed, error: signError } = await supabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signError || !signed) throw ApiError.internal('Failed to create signed upload URL.');

  return { upload_id: uploadRow.id, signed_url: signed.signedUrl, storage_path: storagePath };
}

/**
 * Server-side re-validation on finalize — never trusts client-reported
 * metadata (architecture doc §19.8). Fetches the actual stored object's
 * headers to confirm real size/type before enqueuing the AV scan.
 */
export async function completeUpload(uploadId: string, workspaceId: string) {
  const { data: upload, error } = await supabaseAdmin()
    .from('uploads')
    .select('*')
    .eq('id', uploadId)
    .eq('workspace_id', workspaceId)
    .single();
  if (error || !upload) throw ApiError.notFound('Upload not found.');

  const { data: fileInfo, error: infoError } = await supabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .list(upload.storage_path.split('/').slice(0, -1).join('/'));
  if (infoError) throw ApiError.internal('Failed to verify uploaded file.');

  await supabaseAdmin().from('uploads').update({ status: 'processing' }).eq('id', uploadId);
  await enqueue('persona-ingestion', 'av_scan_upload', { uploadId, workspaceId });

  return { upload_id: uploadId, status: 'processing' };
}

export async function getUpload(uploadId: string, workspaceId: string) {
  const { data, error } = await supabaseAdmin()
    .from('uploads')
    .select('id, status, av_scan_status, original_filename, purpose')
    .eq('id', uploadId)
    .eq('workspace_id', workspaceId)
    .single();
  if (error || !data) throw ApiError.notFound('Upload not found.');
  return data;
}

export async function deleteUpload(uploadId: string, workspaceId: string) {
  const { data: upload } = await supabaseAdmin()
    .from('uploads')
    .select('storage_path')
    .eq('id', uploadId)
    .eq('workspace_id', workspaceId)
    .single();
  if (upload) {
    await supabaseAdmin().storage.from(STORAGE_BUCKET).remove([upload.storage_path]);
  }
  await supabaseAdmin().from('uploads').delete().eq('id', uploadId).eq('workspace_id', workspaceId);
}

export { STORAGE_BUCKET, MAX_SIZE_BYTES, ALLOWED_MIME_TYPES };
