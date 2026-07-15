import axios from 'axios';
import { createLogger } from '../../config/logger';

const log = createLogger('extraction-service');
const MAX_EXTRACTED_CHARS = 20000; // same cap as pasted-text sources, bounds prompt-stuffing risk

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default;
  const result = await pdfParse(buffer);
  return (result.text ?? '').slice(0, MAX_EXTRACTED_CHARS);
}

export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return (result.value ?? '').slice(0, MAX_EXTRACTED_CHARS);
}

/**
 * Public-page fetch only — never anything behind a login. This is a
 * deliberate, stated constraint (architecture doc §2.2.2 of the product
 * blueprint): no LinkedIn-profile scraping, no authenticated-resource
 * fetching. A plain GET against a public URL and HTML-to-text extraction.
 */
export async function extractTextFromUrl(url: string): Promise<string> {
  const response = await axios.get(url, { timeout: 15000, maxContentLength: 5 * 1024 * 1024 });
  const html = String(response.data);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, MAX_EXTRACTED_CHARS);
}

/**
 * OCR/vision extraction for images (business cards, screenshots). Routed
 * through the AI fallback chain's vision-capable tier where available.
 * Best-effort — OCR quality is not guaranteed-accurate, and this is stated
 * to users in the product UX, not just here.
 */
export async function extractTextFromImage(buffer: Buffer): Promise<string> {
  // A minimal, provider-agnostic placeholder: in production this calls a
  // vision-capable model in the AI fallback chain. Kept narrow and separate
  // from the general persona-synthesis prompt path per §19.7 — this call
  // is scoped only to OCR/extraction, never general reasoning.
  log.warn('extractTextFromImage: wire to a vision-capable provider before relying on this in production.');
  return '';
}
