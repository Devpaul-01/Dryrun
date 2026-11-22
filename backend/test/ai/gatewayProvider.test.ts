import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Covers providers/gateway.provider.ts: the request shape sent to the
 * llm-gateway (model + fallback_models, bearer auth, image content parts)
 * and how every failure mode is classified — the classification is what
 * fallbackChain.ts's cooldown/retry decisions are built on.
 */

const postMock = vi.fn();
const isAxiosErrorMock = vi.fn();
vi.mock('axios', () => ({
  default: {
    post: (...args: unknown[]) => postMock(...args),
    isAxiosError: (...args: unknown[]) => isAxiosErrorMock(...args),
  },
}));

vi.mock('../../src/config/env', () => ({
  env: {
    ai: {
      gateway: {
        baseUrl: 'https://gateway.test/v1',
        apiKey: 'gw-key',
        timeoutMs: 60000,
      },
    },
  },
}));

import { gatewayChat, GatewayError, createGatewayProvider } from '../../src/modules/ai/providers/gateway.provider';

const ok = (data: unknown) => ({ status: 200, data, headers: {} });
const fail = (status: number, error?: { code?: string; message?: string }, headers: Record<string, string> = {}) => ({
  status,
  data: error ? { error } : '<html>bad gateway</html>',
  headers,
});

const messages = [{ role: 'user' as const, content: 'hi' }];

beforeEach(() => {
  vi.clearAllMocks();
  isAxiosErrorMock.mockReturnValue(false);
});

describe('gatewayChat — request shape', () => {
  it('sends the first model as `model`, the rest as `fallback_models`, with bearer auth', async () => {
    postMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: 'hello' } }], usage: {} }));

    await gatewayChat({ models: ['a', 'cerebras:b', 'c'], messages, temperature: 0.3, maxTokens: 50 });

    const [url, body, config] = postMock.mock.calls[0];
    expect(url).toBe('https://gateway.test/v1/chat/completions');
    expect(body).toMatchObject({ model: 'a', fallback_models: ['cerebras:b', 'c'], temperature: 0.3, max_tokens: 50, messages });
    expect(config.headers.Authorization).toBe('Bearer gw-key');
    expect(config.timeout).toBe(60000);
  });

  it('omits fallback_models for a single-model chain and honors a per-call timeout', async () => {
    postMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: 'x' } }] }));

    await gatewayChat({ models: ['only'], messages, timeoutMs: 1234 });

    const [, body, config] = postMock.mock.calls[0];
    expect(body).not.toHaveProperty('fallback_models');
    expect(config.timeout).toBe(1234);
  });

  it('passes image content parts through untouched', async () => {
    postMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: 'text' } }] }));
    const parts = [
      { type: 'text' as const, text: 'read this' },
      { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAA' } },
    ];

    await gatewayChat({ models: ['gpt-4o-mini'], messages: [{ role: 'user', content: parts }] });

    expect(postMock.mock.calls[0][1].messages[0].content).toEqual(parts);
  });

  it('createGatewayProvider prepends the system prompt', async () => {
    postMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: 'x' } }] }));

    await createGatewayProvider(['m']).call({ systemPrompt: 'be brief', messages });

    expect(postMock.mock.calls[0][1].messages).toEqual([{ role: 'system', content: 'be brief' }, ...messages]);
  });
});

describe('gatewayChat — response mapping', () => {
  it('reports the upstream provider/model that actually answered, from the gateway block', async () => {
    postMock.mockResolvedValueOnce(
      ok({
        model: 'requested-model',
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        gateway: { provider: 'mistral', model: 'mistral-large-latest', failovers: 1 },
      })
    );

    const result = await gatewayChat({ models: ['requested-model', 'mistral-large-latest'], messages });

    expect(result).toEqual({
      content: 'hello',
      tokensIn: 11,
      tokensOut: 7,
      modelUsed: 'mistral-large-latest',
      providerUsed: 'mistral',
    });
  });

  it('falls back to the echoed/requested model and a generic provider when the gateway block is absent', async () => {
    postMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: 'x' } }] }));

    const result = await gatewayChat({ models: ['m1'], messages });

    expect(result).toMatchObject({ modelUsed: 'm1', providerUsed: 'gateway', tokensIn: 0, tokensOut: 0 });
  });
});

describe('gatewayChat — error classification', () => {
  const kindOf = async (response: ReturnType<typeof fail>) => {
    postMock.mockResolvedValueOnce(response);
    const err = await gatewayChat({ models: ['m'], messages }).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    return err as GatewayError;
  };

  it.each([401, 403])('treats HTTP %i as a rejected gateway key', async (status) => {
    expect((await kindOf(fail(status, { code: 'unauthorized' }))).kind).toBe('auth');
  });

  it.each(['rate_limit_exceeded', 'too_many_concurrent_requests', 'daily_token_budget_exceeded'])(
    'treats a 429 %s as admission control, not a bad key',
    async (code) => {
      expect((await kindOf(fail(429, { code }))).kind).toBe('admission');
    }
  );

  it('exposes Retry-After on admission errors', async () => {
    const err = await kindOf(fail(429, { code: 'daily_token_budget_exceeded' }, { 'retry-after': '3600' }));
    expect(err.retryAfterSeconds).toBe(3600);
    expect(err.code).toBe('daily_token_budget_exceeded');
  });

  it('treats a 400 as a client error', async () => {
    expect((await kindOf(fail(400, { code: 'invalid_message' }))).kind).toBe('client');
  });

  it('treats a gateway-formed 502/503 (JSON error body) as upstream — its failover already ran', async () => {
    expect((await kindOf(fail(503, { code: 'request_failed' }))).kind).toBe('upstream');
    expect((await kindOf(fail(502, { code: 'upstream_failed' }))).kind).toBe('upstream');
  });

  it('treats a bare 502/503/504 (no JSON body) as infrastructure in front of the gateway — retryable', async () => {
    for (const status of [502, 503, 504]) {
      expect((await kindOf(fail(status))).kind).toBe('network');
    }
  });

  it('treats a connection failure as network', async () => {
    postMock.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const err = await gatewayChat({ models: ['m'], messages }).catch((e) => e);
    expect(err.kind).toBe('network');
  });

  it('treats an axios timeout as timeout, not network, so it is never retried', async () => {
    isAxiosErrorMock.mockReturnValue(true);
    postMock.mockRejectedValueOnce(Object.assign(new Error('timeout of 60000ms exceeded'), { code: 'ECONNABORTED' }));
    const err = await gatewayChat({ models: ['m'], messages }).catch((e) => e);
    expect(err.kind).toBe('timeout');
  });
});
