import { createGatewayProvider, GatewayError, isGatewayConfigured } from './providers/gateway.provider';
import { ProviderCallOptions, ProviderCallResult } from './providers/types';
import { redisConnection } from '../../config/redis';
import { env } from '../../config/env';
import { supabaseAdmin } from '../../config/supabase';
import { createLogger } from '../../config/logger';
import { ApiError } from '../../lib/apiError';

const log = createLogger('ai-fallback-chain');

/**
 * All AI calls now go through ONE self-hosted llm-gateway
 * (github.com/Devpaul-01/llm-gateway) instead of this file maintaining its
 * own Cerebras/Groq/OpenAI key pools. The gateway is itself an
 * OpenAI-compatible multi-provider router: it resolves model names to
 * providers, walks a per-request `fallback_models` chain, rotates upstream
 * keys and trips circuit breakers server-side. Re-implementing that here
 * would be two layers doing the same job, so this file only:
 *   1. picks the model chain for the call type (live_turn = fastest tier,
 *      everything else = the derivative chain — architecture doc §10.1),
 *   2. cools down the single gateway key if the gateway starts rejecting
 *      OUR credential (a failure the gateway can't self-heal),
 *   3. retries once on a fast connection-level failure reaching the gateway,
 *   4. keeps the per-workspace daily budget and usage logging, which are
 *      this app's concerns, not the gateway's.
 * The exported `callWithFallback` contract is unchanged, so no call site
 * (ai.service.ts and friends) needs to change.
 */

const TRANSIENT_RETRY_DELAY_MS = 500;
const KEY_COOLDOWN_REDIS_KEY = 'ai-gateway-key-cooldown';

async function isGatewayKeyCooling(): Promise<boolean> {
  return (await redisConnection().exists(KEY_COOLDOWN_REDIS_KEY)) === 1;
}

async function coolGatewayKey(): Promise<void> {
  const seconds = env.ai.gateway.keyCooldownSeconds;
  await redisConnection().set(KEY_COOLDOWN_REDIS_KEY, '1', 'EX', seconds);
  log.error({ cooldownSeconds: seconds }, 'Gateway rejected our API key — pausing AI calls (check GATEWAY_API_KEY)');
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
 * FIX (HIGH-11): previously called only from ai.service.ts's
 * generateBuyerReply (the live_turn path) — persona synthesis, debriefs,
 * scoring, playbooks, and session-comparison summaries were all logged to
 * ai_usage_log (recordUsage below runs for every call type uniformly) but
 * never checked against the per-workspace daily budget, so a workspace
 * could exceed its intended daily AI spend entirely through those other
 * paths. Moved here so every call type is uniformly protected, with a
 * rough per-call-type cost estimate instead of one flat number for all of
 * them — still an approximation (doesn't account for actual prompt
 * length or model), but closer than treating every call type as
 * equally expensive.
 */
const ESTIMATED_COST_USD: Record<string, number> = {
  live_turn: 0.01,
  persona_synthesis: 0.005,
  debrief: 0.004,
  scoring: 0.003,
  playbook: 0.008,
  consistency_check: 0.001,
  session_comparison: 0.002,
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Calls the gateway for the given call type ('live_turn' uses the
 * fastest-tier model chain; every other call type uses the derivative
 * chain, which can tolerate a slower/cheaper first choice). Provider- and
 * model-level failover happens inside the gateway, per request, via
 * `fallback_models` — see the file header.
 */
export async function callWithFallback(
  callType: 'live_turn' | 'persona_synthesis' | 'debrief' | 'scoring' | 'playbook' | 'consistency_check' | 'session_comparison',
  workspaceId: string,
  options: ProviderCallOptions
): Promise<ProviderCallResult> {
  await checkAndReserveBudget(workspaceId, ESTIMATED_COST_USD[callType] ?? 0.01);

  if (!isGatewayConfigured()) {
    log.error('AI gateway is not configured (GATEWAY_BASE_URL / GATEWAY_API_KEY) — every AI call will fail');
    throw ApiError.aiUnavailable();
  }

  if (await isGatewayKeyCooling()) {
    throw ApiError.aiUnavailable('AI is temporarily unavailable. Please try again shortly.');
  }

  const models = callType === 'live_turn' ? env.ai.gateway.liveTurnModels : env.ai.gateway.derivativeModels;
  const provider = createGatewayProvider(models);

  try {
    let result: ProviderCallResult;
    try {
      result = await provider.call(options);
    } catch (err) {
      // One quick retry for a connection-level blip reaching the gateway
      // itself. Anything the gateway answered (including "every upstream
      // failed") has already been through its own failover — don't repeat it.
      if (!(err instanceof GatewayError && err.kind === 'network')) throw err;
      log.warn({ err }, 'Gateway unreachable — retrying once');
      await sleep(TRANSIENT_RETRY_DELAY_MS);
      result = await provider.call(options);
    }

    await recordUsage(workspaceId, callType, result);
    return result;
  } catch (err) {
    const kind = err instanceof GatewayError ? err.kind : 'unknown';
    log.warn({ err, callType, kind, status: err instanceof GatewayError ? err.status : undefined }, 'Gateway call failed');

    if (err instanceof GatewayError && err.kind === 'auth') {
      await coolGatewayKey();
    } else if (kind === 'client' || kind === 'unknown') {
      // A request the gateway rejected as malformed, or an unexpected error
      // here — an application bug, not a transient condition.
      log.error({ err, callType }, 'Gateway call failed with a non-transient error');
    }

    throw ApiError.aiUnavailable();
  }
}
