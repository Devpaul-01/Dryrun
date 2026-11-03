import axios from 'axios';
import dns from 'dns/promises';
import net from 'net';
import { createLogger } from '../../config/logger';
import { env } from '../../config/env';
import { ApiError } from '../../lib/apiError';

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
 * FIX (SSRF — found during the backend-takeover upload-pipeline review):
 * this function's own header comment has long described "public-page
 * fetch only" as a deliberate constraint, but until now that was only
 * ever a stated intent, never actually enforced — persona.schemas.ts's
 * `url: z.string().url()` validates that the input is well-formed as a
 * URL, nothing about scheme or destination. Any authenticated user could
 * submit a persona-source URL like `http://169.254.169.254/...` (cloud
 * instance metadata — a well-known path to credential theft on AWS/GCP/
 * Azure), `http://localhost:6379/...` (this deployment's own Redis), or
 * any other internal address, and this backend would fetch it from its
 * own network position on their behalf.
 *
 * Two checks, because a hostname-based check alone is DNS-rebinding-
 * vulnerable (a domain can resolve to a public IP at validation time and
 * a private one at request time, or simply BE an IP literal already):
 *   1. Scheme must be http/https — rejects file://, gopher://, etc.
 *   2. The hostname is resolved via DNS here, explicitly, and EVERY
 *      resolved address is checked against the private/reserved ranges
 *      below before axios ever makes the request. This doesn't fully
 *      close a TOCTOU gap against a server that deliberately resolves
 *      differently a few milliseconds later, but it closes the actual
 *      reachable attack surface this product's own URLs would hit: IP
 *      literals, and ordinary (non-adversarial) internal hostnames.
 */
const PRIVATE_IP_RANGES = new net.BlockList();
// IPv4: loopback, link-local (incl. cloud metadata 169.254.169.254), the
// three RFC1918 private ranges, and this-host (0.0.0.0/8).
PRIVATE_IP_RANGES.addRange('127.0.0.0', '127.255.255.255', 'ipv4');
PRIVATE_IP_RANGES.addRange('169.254.0.0', '169.254.255.255', 'ipv4');
PRIVATE_IP_RANGES.addRange('10.0.0.0', '10.255.255.255', 'ipv4');
PRIVATE_IP_RANGES.addRange('172.16.0.0', '172.31.255.255', 'ipv4');
PRIVATE_IP_RANGES.addRange('192.168.0.0', '192.168.255.255', 'ipv4');
PRIVATE_IP_RANGES.addRange('0.0.0.0', '0.255.255.255', 'ipv4');
// IPv6: loopback (::1), unique local (fc00::/7), and link-local (fe80::/10).
PRIVATE_IP_RANGES.addSubnet('::1', 128, 'ipv6');
PRIVATE_IP_RANGES.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_IP_RANGES.addSubnet('fe80::', 10, 'ipv6');

async function assertPublicUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw ApiError.badRequest('That URL could not be parsed.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw ApiError.badRequest('Only http/https URLs are supported.');
  }

  // URL.hostname keeps the enclosing brackets for an IPv6 literal (e.g.
  // "[::1]"), but net.isIP doesn't accept the bracketed form — strip them
  // before checking, otherwise a bracketed IPv6 literal falls through to
  // the DNS-lookup branch below instead of being checked directly (it
  // still ends up blocked there today, since dns.lookup rejects the
  // bracketed string as an invalid hostname too, but only incidentally —
  // this makes the IP-literal check actually the one responsible for it).
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  // An IP literal in the URL itself (net.isIP returns 0 for a non-IP
  // hostname, 4 or 6 for a literal) — check it directly without a DNS
  // round-trip.
  if (net.isIP(hostname)) {
    if (PRIVATE_IP_RANGES.check(hostname, net.isIPv6(hostname) ? 'ipv6' : 'ipv4')) {
      throw ApiError.badRequest('That URL points to a non-public address and cannot be fetched.');
    }
    return parsed;
  }

  let addresses: string[];
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = records.map((r) => r.address);
  } catch {
    throw ApiError.badRequest('That URL\'s host could not be resolved.');
  }
  if (addresses.length === 0) {
    throw ApiError.badRequest('That URL\'s host could not be resolved.');
  }
  for (const address of addresses) {
    if (PRIVATE_IP_RANGES.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4')) {
      throw ApiError.badRequest('That URL points to a non-public address and cannot be fetched.');
    }
  }
  return parsed;
}

const MAX_URL_REDIRECTS = 5;

/**
 * Public-page fetch only — never anything behind a login. This is a
 * deliberate, stated constraint (architecture doc §2.2.2 of the product
 * blueprint): no LinkedIn-profile scraping, no authenticated-resource
 * fetching. A plain GET against a public URL and HTML-to-text extraction.
 * assertPublicUrl above is what actually enforces "public" now, not just
 * states it.
 *
 * Redirects are followed manually (axios's own maxRedirects is disabled
 * below) specifically so each hop can be re-validated through
 * assertPublicUrl before it's followed — an ordinary public page
 * redirecting to a private address (deliberately, or via a compromised/
 * misconfigured upstream) would otherwise bypass the check on the
 * original URL entirely, since axios's built-in redirect-following
 * happens after that check already passed. A bounded hop count (5, the
 * same default axios itself normally uses) prevents a redirect loop from
 * hanging the job indefinitely.
 */
export async function extractTextFromUrl(url: string): Promise<string> {
  let currentUrl = url;
  let html: string | null = null;
  for (let hop = 0; hop <= MAX_URL_REDIRECTS; hop++) {
    await assertPublicUrl(currentUrl);
    const response = await axios.get(currentUrl, {
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024,
      maxRedirects: 0,
      validateStatus: (status) => (status >= 200 && status < 300) || (status >= 300 && status < 400),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) throw ApiError.badRequest('That URL redirected without a destination.');
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    html = String(response.data);
    break;
  }
  if (html === null) {
    throw ApiError.badRequest('That URL redirected too many times.');
  }
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

  // FIX (audit finding M6): reads through env.ts's centralized accessor
  // instead of process.env directly — OPENAI_API_KEY_1 is index 0 of the
  // openai provider's key array (env.ai.providerKeys.openai), the exact
  // same accessor fallbackChain.ts now uses.
  const apiKey = env.ai.providerKeys.openai[0];
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
