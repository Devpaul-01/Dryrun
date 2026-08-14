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

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // matches upload.service.ts's own upload size cap — this function is never the first line of size enforcement, but never trusts a caller blindly either
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg']); // matches upload.service.ts's ALLOWED_MIME_TYPES for image/*
const OCR_TIMEOUT_MS = 30000;
const VISION_MODEL = 'gpt-4o-mini'; // the one already-registered provider model in this codebase with vision support

/**
 * OCR/vision extraction for images (business cards, screenshots). Routed
 * through a direct call to OpenAI's vision-capable Chat Completions
 * endpoint — NOT through modules/ai/fallbackChain.ts's callWithFallback().
 * That shared pipeline's ProviderCallOptions.messages[].content is typed
 * as a plain string everywhere (promptBuilder.ts's five prompt builders
 * all assume this), and widening it to also support OpenAI's
 * array-of-content-blocks image shape would touch every one of those
 * builders for a capability only this one narrow call needs. Kept
 * narrow and separate from the general persona-synthesis prompt path per
 * §19.7 — this call is scoped only to OCR/extraction, never general
 * reasoning, consistent with what this function's original comment
 * already stated before it had a real implementation.
 *
 * Uses only the first configured OpenAI key (OPENAI_API_KEY_1) directly,
 * not the full multi-key/cooldown fallback registry — image-based
 * persona sources are a minor, infrequent input path (one call per
 * uploaded image during persona-from-source ingestion), not a
 * high-volume path like live-turn chat that justifies the fallback
 * chain's operational complexity. If this path's volume or reliability
 * needs grow, promoting it into the shared fallback chain (by widening
 * ProviderCallOptions as described above) is the natural next step.
 *
 * MEMORY EFFICIENCY: `buffer.toString('base64')` already produces a new
 * string (base64 is ~33% larger than the binary it encodes) — this is
 * unavoidable, since the wire format requires it. What this function
 * avoids is any FURTHER redundant copying beyond that one necessary
 * encode: the data-URL template literal is built once and passed
 * directly into the request body, never re-encoded, reformatted, or
 * held in more than one place at a time. The input buffer itself is
 * never mutated or duplicated before encoding.
 *
 * VALIDATION: re-checks size and mime type defensively even though
 * upload.service.ts already enforces both at upload time — this
 * function is called from extractPersonaSource.worker.ts with whatever
 * mime_type is stored on the uploads row, and a defensive check here
 * costs nothing and fails closed rather than sending an oversized or
 * wrong-type payload to a paid external API.
 *
 * ERROR HANDLING: OCR is explicitly best-effort (stated in this
 * function's own long-standing comment and in product UX) — a failure
 * here returns an empty string rather than throwing, so a bad/unreadable
 * image degrades the persona-source pipeline gracefully (the source is
 * still recorded, just without extracted text) rather than failing the
 * whole extraction job. This mirrors extractTextFromUrl's and
 * extractTextFromPdf's own tolerance for partial/empty results, though
 * those two let a thrown error propagate to the worker's catch block
 * (which marks the source 'extraction_failed'); this one instead
 * swallows the error and returns '' specifically because an image OCR
 * failure is far more likely to be "this image had no readable text"
 * (a normal, expected outcome) than a genuine processing failure, and
 * the worker's existing 'extraction_failed' path is written for the
 * latter, not the former.
 */
export async function extractTextFromImage(buffer: Buffer, mimeType: string = 'image/jpeg'): Promise<string> {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    log.warn({ mimeType }, 'extractTextFromImage: unsupported mime type, skipping OCR');
    return '';
  }
  if (buffer.length === 0) {
    log.warn('extractTextFromImage: received an empty buffer, skipping OCR');
    return '';
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    log.warn({ sizeBytes: buffer.length, maxBytes: MAX_IMAGE_BYTES }, 'extractTextFromImage: image exceeds size cap, skipping OCR');
    return '';
  }

  const apiKey = process.env.OPENAI_API_KEY_1;
  if (!apiKey) {
    log.warn('extractTextFromImage: no OpenAI API key configured (OPENAI_API_KEY_1) — OCR unavailable');
    return '';
  }

  try {
    const base64Image = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: VISION_MODEL,
        temperature: 0,
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract all readable text from this image verbatim. If there is no readable text, respond with an empty string. Do not describe the image, only transcribe text present in it.',
              },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      },
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        timeout: OCR_TIMEOUT_MS,
      }
    );

    const extracted = response.data?.choices?.[0]?.message?.content ?? '';
    return String(extracted).slice(0, MAX_EXTRACTED_CHARS);
  } catch (err) {
    // Best-effort by design (see function header) — never throw out of
    // this function; a failed OCR attempt degrades to "no extracted
    // text" rather than failing the persona-source ingestion job.
    log.warn({ err }, 'extractTextFromImage: OCR request failed, returning empty result');
    return '';
  }
}
