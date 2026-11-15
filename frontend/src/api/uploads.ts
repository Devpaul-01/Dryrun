import { httpClient } from '@/api/httpClient';
import type { SignedUploadRequest } from '@/types/requests';

export interface SignedUploadResponse {
  upload_id: string;
  signed_url: string;
  storage_path: string;
}

export function createSignedUpload(body: SignedUploadRequest) {
  return httpClient.post<SignedUploadResponse>('/uploads/signed-url', body).then((res) => res.data);
}

/** Marks the bytes as uploaded and kicks off the AV scan (+ extraction for persona sources). */
export function completeUpload(uploadId: string) {
  return httpClient
    .post<{ upload_id: string; status: string }>(`/uploads/${uploadId}/complete`)
    .then((res) => res.data);
}

/**
 * Sends the file bytes straight to Supabase Storage via the signed URL —
 * deliberately NOT through httpClient: the signed URL carries its own auth
 * token, and our bearer/workspace headers must not leak to another origin.
 */
export async function putToSignedUrl(signedUrl: string, body: Blob, mimeType: string): Promise<void> {
  const response = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body,
  });
  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}). Please try again.`);
  }
}
