import axios from 'axios';
import { env } from '../../../config/env';
import { AiProvider, ProviderCallOptions, ProviderCallResult } from './types';

/**
 * Client for the self-hosted llm-gateway (github.com/Devpaul-01/llm-gateway):
 * an OpenAI-compatible `POST {base}/chat/completions` endpoint that does
 * model-alias resolution, per-request `fallback_models` chaining, upstream
 * key rotation and circuit breaking server-side. This replaces the old
 * per-provider adapter (one instance per Cerebras/Groq/OpenAI key) — there
 * is now exactly one endpoint and one credential on this side.
 */

export type GatewayContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface GatewayMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | GatewayContentPart[];
}

/**
 * How a failed gateway call should be treated by the caller:
 *  - `auth`       the gateway rejected OUR key (401/403). Retrying won't help
 *                 and the key should be cooled down.
 *  - `admission`  a 429 from the gateway's own admission control (per-key rate
 *                 limit, per-project concurrency, daily token budget). Not a
 *                 bad key and not worth retrying immediately — never cool the
 *                 key for these.
 *  - `network`    no usable answer FROM the gateway: connection failure, or a
 *                 bare 502/503/504 from infrastructure in front of it (no JSON
 *                 error body). Fast-failing, so safe to retry once.
 *  - `timeout`    the request ran out its whole timeout. Not retried: a second
 *                 attempt would just double an already long wait.
 *  - `upstream`   the gateway answered but could not produce a completion — it
 *                 already walked its whole fallback chain. Retrying immediately
 *                 just repeats that work.
 *  - `client`     the gateway rejected the request itself (400/404/413). A bug
 *                 on this side, not a transient condition.
 */
export type GatewayErrorKind = 'auth' | 'admission' | 'network' | 'timeout' | 'upstream' | 'client';

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly kind: GatewayErrorKind,
    readonly status?: number,
    readonly code?: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

const ADMISSION_CODES = new Set(['rate_limit_exceeded', 'too_many_concurrent_requests', 'daily_token_budget_exceeded']);

function classifyHttpError(status: number, code: string | undefined, hasJsonErrorBody: boolean): GatewayErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return code && ADMISSION_CODES.has(code) ? 'admission' : 'upstream';
  if (status === 400 || status === 404 || status === 413) return 'client';
  // 502/503/504 WITHOUT the gateway's JSON error envelope came from whatever
  // sits in front of it (load balancer, cold machine), not from the gateway.
  if ((status === 502 || status === 503 || status === 504) && !hasJsonErrorBody) return 'network';
  return 'upstream';
}

export function isGatewayConfigured(): boolean {
  return Boolean(env.ai.gateway.baseUrl && env.ai.gateway.apiKey);
}

export interface GatewayChatParams {
  /** Ordered model chain: first entry is the primary, the rest become `fallback_models`. */
  models: string[];
  messages: GatewayMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Overrides env.ai.gateway.timeoutMs for this call (e.g. a tighter bound on a best-effort path). */
  timeoutMs?: number;
}

export interface GatewayChatResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  /** The upstream model that actually answered, per the gateway's `gateway` metadata block. */
  modelUsed: string;
  /** The upstream provider that actually answered (e.g. `groq`), per the same block. */
  providerUsed: string;
}

export async function gatewayChat(params: GatewayChatParams): Promise<GatewayChatResult> {
  const { baseUrl, apiKey } = env.ai.gateway;
  const timeoutMs = params.timeoutMs ?? env.ai.gateway.timeoutMs;
  const [primary, ...fallbacks] = params.models;

  let response;
  try {
    response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: primary,
        ...(fallbacks.length > 0 ? { fallback_models: fallbacks } : {}),
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 1200,
        messages: params.messages,
      },
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        timeout: timeoutMs,
        // Classify every HTTP status ourselves instead of letting axios throw
        // on non-2xx, so the gateway's error body is always readable.
        validateStatus: () => true,
      }
    );
  } catch (err) {
    // No HTTP response at all: DNS failure, refused/reset connection, or timeout.
    const timedOut = axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT');
    throw new GatewayError(err instanceof Error ? err.message : String(err), timedOut ? 'timeout' : 'network');
  }

  if (response.status < 200 || response.status >= 300) {
    const errorBody = (response.data as { error?: { message?: string; code?: string } } | undefined)?.error;
    const retryAfter = parseInt(String(response.headers?.['retry-after'] ?? ''), 10);
    throw new GatewayError(
      `Gateway HTTP ${response.status}${errorBody?.code ? ` (${errorBody.code})` : ''}: ${errorBody?.message ?? 'no error body'}`,
      classifyHttpError(response.status, errorBody?.code, Boolean(errorBody)),
      response.status,
      errorBody?.code,
      Number.isNaN(retryAfter) ? undefined : retryAfter
    );
  }

  const data = response.data;
  const usage = data?.usage ?? {};
  return {
    content: data?.choices?.[0]?.message?.content ?? '',
    tokensIn: usage.prompt_tokens ?? 0,
    tokensOut: usage.completion_tokens ?? 0,
    // `gateway.provider` / `gateway.model` report what ACTUALLY served the
    // request after any failover; the top-level `model` is only what the
    // gateway echoes back, so it's the last resort.
    modelUsed: data?.gateway?.model ?? data?.model ?? primary,
    providerUsed: data?.gateway?.provider ?? 'gateway',
  };
}

/** Adapter exposing a fixed model chain through the app's existing AiProvider interface. */
export function createGatewayProvider(models: string[]): AiProvider {
  return {
    name: 'gateway',
    call: (options: ProviderCallOptions): Promise<ProviderCallResult> =>
      gatewayChat({
        models,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        messages: [
          ...(options.systemPrompt ? [{ role: 'system' as const, content: options.systemPrompt }] : []),
          ...options.messages,
        ],
      }),
  };
}
