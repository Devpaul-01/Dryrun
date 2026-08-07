import { createOpenAiLikeProvider } from './providers/openaiLike.provider';
import { AiProvider, ProviderCallOptions, ProviderCallResult } from './providers/types';
import { redisConnection } from '../../config/redis';
import { env } from '../../config/env';
import { supabaseAdmin } from '../../config/supabase';
import { createLogger } from '../../config/logger';
import { ApiError } from '../../lib/apiError';

const log = createLogger('ai-fallback-chain');

const COOLDOWN_SECONDS = 60 * 60; // 1 hour, matches the pattern proven in the prior codebase

function buildProviderRegistry(): Record<string, AiProvider[]> {
  const registry: Record<string, AiProvider[]> = { cerebras: [], groq: [], openai: [] };

  for (let i = 1; i <= 5; i++) {
    const cerebrasKey = process.env[`CEREBRAS_API_KEY_${i}`];
    if (cerebrasKey) {
      registry.cerebras.push(
        createOpenAiLikeProvider({
          name: `cerebras-${i}`,
          baseUrl: 'https://api.cerebras.ai/v1',
          apiKey: cerebrasKey,
          model: 'gpt-oss-120b',
        })
      );
    }
    const groqKey = process.env[`GROQ_API_KEY_${i}`];
    if (groqKey) {
      registry.groq.push(
        createOpenAiLikeProvider({
          name: `groq-${i}`,
          baseUrl: 'https://api.groq.com/openai/v1',
          apiKey: groqKey,
          model: 'llama-3.3-70b-versatile',
        })
      );
    }
    const openaiKey = process.env[`OPENAI_API_KEY_${i}`];
    if (openaiKey) {
      registry.openai.push(
        createOpenAiLikeProvider({
          name: `openai-${i}`,
          baseUrl: 'https://api.openai.com/v1',
          apiKey: openaiKey,
          model: 'gpt-4o-mini',
        })
      );
    }
  }
  return registry;
}

let _registry: Record<string, AiProvider[]> | null = null;
function registry() {
  if (!_registry) _registry = buildProviderRegistry();
  return _registry;
}

function cooldownKey(providerName: string) {
  return `ai-provider-cooldown:${providerName}`;
}

async function isOnCooldown(providerName: string): Promise<boolean> {
  const redis = redisConnection();
  return (await redis.exists(cooldownKey(providerName))) === 1;
}

async function markCooldown(providerName: string): Promise<void> {
  const redis = redisConnection();
  await redis.set(cooldownKey(providerName), '1', 'EX', COOLDOWN_SECONDS);
  log.warn({ providerName }, 'Provider cooling down after failure');
}

async function buildQueue(priority: string[]): Promise<AiProvider[]> {
  const queue: AiProvider[] = [];
  for (const providerFamily of priority) {
    const providers = registry()[providerFamily] ?? [];
    for (const provider of providers) {
      if (!(await isOnCooldown(provider.name))) {
        queue.push(provider);
      }
    }
  }
  return queue;
}

const RETRYABLE_SIGNALS = ['429', 'rate limit', '401', '403', '500', '502', '503', 'timeout', 'econnrefused'];
function isRetryable(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return RETRYABLE_SIGNALS.some((s) => message.includes(s));
}

/** ── Per-workspace AI budget (Redis, daily window) ─────────────────────── */
function budgetKey(workspaceId: string) {
  const day = new Date().toISOString().slice(0, 10);
  return `ai-budget:${workspaceId}:${day}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Atomic check-and-reserve, via the Lua script registered in
 * config/redis.ts (see that file's header comment for the full race-
 * condition rationale). Two concurrent calls for the same workspace can
 * no longer both observe "under budget" and both proceed — Redis executes
 * the check-and-increment as one indivisible operation.
 */
export async function checkAndReserveBudget(workspaceId: string, estimatedCostUsd = 0.01): Promise<void> {
  // Anonymous demo sessions use the synthetic workspace ID "demo", not a
  // real workspace row — bounded separately by the demo message cap and
  // per-IP rate limit (modules/demo/demo.service.ts), not the per-workspace
  // budget, which requires a real UUID for its Postgres usage-log FK.
  if (!UUID_RE.test(workspaceId)) return;
  const redis = redisConnection();
  const key = budgetKey(workspaceId);

  const reserved = await redis.checkAndReserveBudget(
    key,
    String(estimatedCostUsd),
    String(env.defaults.aiDailyBudgetUsdPerWorkspace),
    String(60 * 60 * 26) // slightly over a day, covers timezone drift
  );

  if (reserved !== 1) {
    throw ApiError.budgetExceeded();
  }
}

/** ── Token/cost accounting ──────────────────────────────────────────────── */
async function recordUsage(
  workspaceId: string,
  callType: string,
  result: ProviderCallResult
): Promise<void> {
  if (!UUID_RE.test(workspaceId)) return; // demo session — no workspace row to attribute usage to
  await supabaseAdmin().from('ai_usage_log').insert({
    workspace_id: workspaceId,
    call_type: callType,
    provider: result.providerUsed,
    model: result.modelUsed,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
  });
}

/**
 * Attempts each provider/key in priority order for the given call type
 * ('live_turn' uses the fastest-tier priority list; every other call type
 * uses the derivative priority list, which can tolerate a slower/cheaper
 * provider — architecture doc §10.1).
 */
export async function callWithFallback(
  callType: 'live_turn' | 'persona_synthesis' | 'debrief' | 'scoring' | 'playbook' | 'consistency_check' | 'session_comparison',
  workspaceId: string,
  options: ProviderCallOptions
): Promise<ProviderCallResult> {
  const priority = callType === 'live_turn' ? env.ai.liveTurnPriority : env.ai.derivativePriority;
  const queue = await buildQueue(priority);

  if (queue.length === 0) {
    throw ApiError.aiUnavailable('All AI providers are currently unavailable. Please try again shortly.');
  }

  let lastErr: unknown;
  for (const provider of queue) {
    try {
      const result = await provider.call(options);
      await recordUsage(workspaceId, callType, result);
      return result;
    } catch (err) {
      lastErr = err;
      log.warn({ provider: provider.name, err }, 'Provider call failed');
      if (isRetryable(err)) {
        await markCooldown(provider.name);
        continue;
      }
      throw err; // non-retryable — bail immediately rather than burning through the whole chain
    }
  }

  log.error({ lastErr }, 'All providers in fallback chain exhausted');
  throw ApiError.aiUnavailable();
}
