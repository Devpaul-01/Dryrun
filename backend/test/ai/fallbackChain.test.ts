import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Covers fallbackChain.ts's control flow on top of the gateway client:
 * which model chain each call type gets, when the gateway key is cooled
 * down (only when OUR key is rejected), the single retry on a fast
 * connection-level failure, and that every failure surfaces as
 * ApiError.aiUnavailable. The gateway client itself is covered in
 * gatewayProvider.test.ts; the network, Redis and Supabase are mocked.
 */

const callMock = vi.fn();
const createGatewayProviderMock = vi.fn((models: string[]) => {
  void models;
  return { name: 'gateway', call: (...args: unknown[]) => callMock(...args) };
});
let configured = true;

vi.mock('../../src/modules/ai/providers/gateway.provider', async () => {
  // Keep the real GatewayError so `instanceof` checks in fallbackChain.ts behave as in production.
  const actual = await vi.importActual<typeof import('../../src/modules/ai/providers/gateway.provider')>(
    '../../src/modules/ai/providers/gateway.provider'
  );
  return {
    GatewayError: actual.GatewayError,
    isGatewayConfigured: () => configured,
    createGatewayProvider: (models: string[]) => createGatewayProviderMock(models),
  };
});

vi.mock('../../src/config/env', () => ({
  env: {
    logLevel: 'silent', // read by the real config/logger.ts
    defaults: { aiDailyBudgetUsdPerWorkspace: 5 },
    ai: {
      gateway: {
        baseUrl: 'https://gateway.test/v1',
        apiKey: 'gw-key',
        timeoutMs: 60000,
        keyCooldownSeconds: 300,
        liveTurnModels: ['live-a', 'live-b'],
        derivativeModels: ['deriv-a', 'deriv-b'],
        visionModels: ['vision-a'],
      },
    },
  },
}));

const existsMock = vi.fn();
const setMock = vi.fn();
const reserveMock = vi.fn();
vi.mock('../../src/config/redis', () => ({
  redisConnection: () => ({
    exists: (...args: unknown[]) => existsMock(...args),
    set: (...args: unknown[]) => setMock(...args),
    checkAndReserveBudget: (...args: unknown[]) => reserveMock(...args),
  }),
}));

const insertMock = vi.fn();
vi.mock('../../src/config/supabase', () => ({
  supabaseAdmin: () => ({ from: () => ({ insert: (...args: unknown[]) => insertMock(...args) }) }),
}));

import { callWithFallback } from '../../src/modules/ai/fallbackChain';
import { GatewayError } from '../../src/modules/ai/providers/gateway.provider';
import { ApiError } from '../../src/lib/apiError';

const WORKSPACE_ID = '123e4567-e89b-42d3-a456-426614174000';
const options = { systemPrompt: 'sys', messages: [{ role: 'user' as const, content: 'hi' }] };
const gatewayResult = { content: 'ok', tokensIn: 5, tokensOut: 6, modelUsed: 'live-b', providerUsed: 'groq' };

beforeEach(() => {
  vi.clearAllMocks();
  configured = true;
  existsMock.mockResolvedValue(0);
  reserveMock.mockResolvedValue(1);
  insertMock.mockResolvedValue({});
});

describe('callWithFallback — model chain selection', () => {
  it('uses the live-turn chain for live_turn', async () => {
    callMock.mockResolvedValueOnce(gatewayResult);
    await callWithFallback('live_turn', WORKSPACE_ID, options);
    expect(createGatewayProviderMock).toHaveBeenCalledWith(['live-a', 'live-b']);
  });

  it.each(['persona_synthesis', 'debrief', 'scoring', 'playbook', 'session_comparison'] as const)(
    'uses the derivative chain for %s',
    async (callType) => {
      callMock.mockResolvedValueOnce(gatewayResult);
      await callWithFallback(callType, WORKSPACE_ID, options);
      expect(createGatewayProviderMock).toHaveBeenCalledWith(['deriv-a', 'deriv-b']);
    }
  );
});

describe('callWithFallback — success path', () => {
  it('returns the gateway result and logs the upstream provider/model that actually answered', async () => {
    callMock.mockResolvedValueOnce(gatewayResult);

    const result = await callWithFallback('live_turn', WORKSPACE_ID, options);

    expect(result).toEqual(gatewayResult);
    expect(insertMock).toHaveBeenCalledWith({
      workspace_id: WORKSPACE_ID,
      call_type: 'live_turn',
      provider: 'groq',
      model: 'live-b',
      tokens_in: 5,
      tokens_out: 6,
    });
  });

  it('skips usage logging for anonymous demo sessions (non-UUID workspace)', async () => {
    callMock.mockResolvedValueOnce(gatewayResult);

    await callWithFallback('live_turn', 'demo', options);

    expect(reserveMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('still enforces the per-workspace budget before calling the gateway', async () => {
    reserveMock.mockResolvedValueOnce(0);

    await expect(callWithFallback('live_turn', WORKSPACE_ID, options)).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
    expect(callMock).not.toHaveBeenCalled();
  });
});

describe('callWithFallback — gateway unavailable paths', () => {
  it('fails fast with aiUnavailable when the gateway is not configured', async () => {
    configured = false;

    await expect(callWithFallback('live_turn', WORKSPACE_ID, options)).rejects.toBeInstanceOf(ApiError);
    expect(callMock).not.toHaveBeenCalled();
  });

  it('fails fast while the gateway key is cooling down', async () => {
    existsMock.mockResolvedValueOnce(1);

    await expect(callWithFallback('live_turn', WORKSPACE_ID, options)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(callMock).not.toHaveBeenCalled();
  });

  it('cools the gateway key down when the gateway rejects it (401)', async () => {
    callMock.mockRejectedValueOnce(new GatewayError('Gateway HTTP 401', 'auth', 401, 'unauthorized'));

    await expect(callWithFallback('live_turn', WORKSPACE_ID, options)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(setMock).toHaveBeenCalledWith('ai-gateway-key-cooldown', '1', 'EX', 300);
  });

  it.each([
    ['admission', 429, 'daily_token_budget_exceeded'],
    ['upstream', 503, 'request_failed'],
    ['timeout', undefined, undefined],
    ['client', 400, 'invalid_message'],
  ] as const)('does NOT cool the key for a %s failure, and does not retry it', async (kind, status, code) => {
    callMock.mockRejectedValueOnce(new GatewayError('boom', kind, status, code));

    await expect(callWithFallback('live_turn', WORKSPACE_ID, options)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(setMock).not.toHaveBeenCalled();
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  it('wraps an unexpected non-gateway error as aiUnavailable too', async () => {
    callMock.mockRejectedValueOnce(new Error('something odd'));

    await expect(callWithFallback('live_turn', WORKSPACE_ID, options)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
});

describe('callWithFallback — retry on a connection-level failure', () => {
  it('retries once and succeeds when the first attempt cannot reach the gateway', async () => {
    callMock.mockRejectedValueOnce(new GatewayError('ECONNRESET', 'network')).mockResolvedValueOnce(gatewayResult);

    const result = await callWithFallback('live_turn', WORKSPACE_ID, options);

    expect(result).toEqual(gatewayResult);
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after exactly one retry', async () => {
    callMock.mockRejectedValue(new GatewayError('ECONNRESET', 'network'));

    await expect(callWithFallback('live_turn', WORKSPACE_ID, options)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(callMock).toHaveBeenCalledTimes(2);
    expect(setMock).not.toHaveBeenCalled();
  });
});
