import 'dotenv/config';

/**
 * Centralized, typed environment configuration.
 * Every configurable value in the application is read through this module —
 * nothing reaches into `process.env` directly anywhere else in the codebase.
 * This is what makes "no hardcoded values" an enforceable convention rather
 * than a hope.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A set-but-blank variable (e.g. `NAME=` copied from .env.example) falls back to the default, so a list is never silently empty. */
function optionalCsv(name: string, fallback: string): string[] {
  const parsed = splitCsv(process.env[name] ?? '');
  return parsed.length > 0 ? parsed : splitCsv(fallback);
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
  port: optionalInt('PORT', 3001),
  logLevel: optional('LOG_LEVEL', 'info'),
  adminAllowlistIps: optional('ADMIN_ALLOWLIST_IPS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  frontendUrl: optional('FRONTEND_URL', 'http://localhost:5173'),
  frontendMobileScheme: optional('FRONTEND_URL_MOBILE_SCHEME', 'dryrun://auth-callback'),

  supabase: {
    url: () => required('SUPABASE_URL'),
    serviceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
    anonKey: optional('SUPABASE_ANON_KEY'),
    jwtSecret: optional('SUPABASE_JWT_SECRET'),
    // Auth > Hooks > Send Email secret from the Supabase dashboard —
    // format "v1,whsec_<base64>". Used to verify that POST
    // /api/v1/auth/email-hook requests genuinely originate from Supabase
    // (see modules/auth/emailHook.service.ts).
    sendEmailHookSecret: optional('SUPABASE_SEND_EMAIL_HOOK_SECRET'),
  },

  redisUrl: () => required('REDIS_URL'),

  /**
   * All AI traffic goes through one self-hosted llm-gateway
   * (github.com/Devpaul-01/llm-gateway), an OpenAI-compatible router that
   * owns provider selection, per-request model fallback, and upstream key
   * rotation/cooldown. This app therefore needs exactly one base URL and
   * one gateway key — the old CEREBRAS/GROQ/OPENAI_API_KEY_1..5 variables
   * and the *_MODEL_PRIORITY provider lists are gone; provider keys now
   * live in the gateway's own project config.
   *
   * Each *Models list is an ordered chain: the first entry is sent as the
   * request's `model`, the rest as `fallback_models`. Entries use the
   * gateway's own syntax — a bare model name it already maps to a provider
   * (e.g. `llama-3.3-70b-versatile`) or an explicit `provider:model`
   * (e.g. `cerebras:gpt-oss-120b`).
   */
  ai: {
    gateway: {
      baseUrl: optional('GATEWAY_BASE_URL').replace(/\/+$/, ''),
      apiKey: optional('GATEWAY_API_KEY'),
      // Fastest-tier chain for live conversation turns.
      liveTurnModels: optionalCsv('AI_GATEWAY_LIVE_TURN_MODELS', 'cerebras:gpt-oss-120b,llama-3.3-70b-versatile,gpt-4o-mini'),
      // Every other call type (persona synthesis, debriefs, scoring, ...) —
      // can tolerate a slower/cheaper first choice.
      derivativeModels: optionalCsv('AI_GATEWAY_DERIVATIVE_MODELS', 'llama-3.3-70b-versatile,gpt-4o-mini,cerebras:gpt-oss-120b'),
      // Image requests (OCR). Every entry must be vision-capable — the
      // gateway filters non-vision candidates out of an image request.
      visionModels: optionalCsv('AI_GATEWAY_VISION_MODELS', 'gpt-4o-mini,meta-llama/llama-4-scout-17b-16e-instruct'),
      // Whole-request timeout. Must cover the gateway's own failover chain
      // (up to one attempt per model in the list), not a single upstream call.
      timeoutMs: optionalInt('AI_GATEWAY_TIMEOUT_MS', 60000),
      // How long to stop calling the gateway after it rejects OUR key (401/403).
      keyCooldownSeconds: optionalInt('AI_GATEWAY_KEY_COOLDOWN_SECONDS', 300),
    },
  },

  flutterwave: {
    publicKey: optional('FLUTTERWAVE_PUBLIC_KEY'),
    secretKey: optional('FLUTTERWAVE_SECRET_KEY'),
    webhookSecretHash: optional('FLUTTERWAVE_WEBHOOK_SECRET_HASH'),
  },

  email: {
    provider: optional('EMAIL_PROVIDER', 'console'),
    from: optional('EMAIL_FROM', 'noreply@dryrun.app'),
    resendApiKey: optional('RESEND_API_KEY'),
    smtp: {
      host: optional('SMTP_HOST'),
      port: optionalInt('SMTP_PORT', 587),
      user: optional('SMTP_USER'),
      pass: optional('SMTP_PASS'),
    },
  },

  expoAccessToken: optional('EXPO_ACCESS_TOKEN'),

  posthog: {
    apiKey: optional('POSTHOG_API_KEY'),
    host: optional('POSTHOG_HOST', 'https://app.posthog.com'),
  },

  sentry: {
    dsn: optional('SENTRY_DSN'),
    environment: optional('SENTRY_ENVIRONMENT', 'development'),
  },

  clamscan: {
    host: optional('CLAMSCAN_HOST', '127.0.0.1'),
    port: optionalInt('CLAMSCAN_PORT', 3310),
  },

  defaults: {
    paymentEnforcementEnabled: optional('DEFAULT_PAYMENT_ENFORCEMENT_ENABLED', 'false') === 'true',
    freeSessionLimitPerMonth: optionalInt('DEFAULT_FREE_SESSION_LIMIT_PER_MONTH', 4),
    sessionAttachmentCap: optionalInt('DEFAULT_SESSION_ATTACHMENT_CAP', 5),
    aiDailyBudgetUsdPerWorkspace: optionalInt('DEFAULT_AI_DAILY_BUDGET_USD_PER_WORKSPACE', 5),
  },
};

/**
 * FIX (LOW-1): Flutterwave keys deliberately stay `optional()` above
 * rather than `required()` — unlike Supabase/Redis, a missing key here
 * doesn't crash every request, it just means checkout/webhook
 * verification will fail later, silently, the first time someone
 * actually tries to pay. That's a worse failure mode for a production
 * deployment than failing loudly up front, so this warns (doesn't throw
 * — a demo/staging instance with payment_enforcement_enabled left off
 * may legitimately run with no billing configured at all) whenever
 * NODE_ENV=production and any key is missing.
 *
 * Uses plain console.warn rather than config/logger.ts's createLogger:
 * logger.ts itself imports `env` from this module, so importing logger.ts
 * here would be a circular import. This is a narrow, deliberate exception
 * to this codebase's usual logging convention, for exactly that reason.
 */
if (env.isProduction) {
  const missingFlutterwaveKeys = [
    !env.flutterwave.secretKey && 'FLUTTERWAVE_SECRET_KEY',
    !env.flutterwave.publicKey && 'FLUTTERWAVE_PUBLIC_KEY',
    !env.flutterwave.webhookSecretHash && 'FLUTTERWAVE_WEBHOOK_SECRET_HASH',
  ].filter(Boolean);
  if (missingFlutterwaveKeys.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[env] WARNING: running in production with missing Flutterwave configuration: ${missingFlutterwaveKeys.join(', ')}. Checkout and webhook verification will fail until these are set.`
    );
  }
}
