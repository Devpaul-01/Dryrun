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

/**
 * FIX (audit finding M6): AI provider keys previously bypassed this module
 * entirely — fallbackChain.ts and extraction.service.ts both read
 * `process.env.CEREBRAS_API_KEY_${i}` / `GROQ_API_KEY_${i}` /
 * `OPENAI_API_KEY_${i}` directly, contradicting this file's own header
 * comment ("nothing reaches into process.env directly anywhere else in
 * the codebase"). These keys don't fit env.ts's existing flat-property
 * shape naturally (each provider supports a variable NUMBER of keys, 1
 * through 5, and every individual key is genuinely optional — a
 * deployment may configure zero, one, or up to five keys per provider
 * family, so `required()` is the wrong tool here). This accessor keeps
 * that same optional, variable-count shape while still routing every
 * read through this module, closing the "these specific keys aren't
 * validated the way everything else is" gap: a missing/malformed key
 * previously only surfaced as a runtime failure deep inside a provider
 * call; callers can now see exactly which numbered keys are actually
 * configured for a given provider family without reaching into
 * process.env themselves.
 */
function numberedProviderKeys(prefix: 'CEREBRAS_API_KEY' | 'GROQ_API_KEY' | 'OPENAI_API_KEY'): (string | undefined)[] {
  const keys: (string | undefined)[] = [];
  for (let i = 1; i <= 5; i++) {
    keys.push(optional(`${prefix}_${i}`) || undefined);
  }
  return keys;
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

  ai: {
    liveTurnPriority: optional('AI_LIVE_TURN_MODEL_PRIORITY', 'cerebras,groq,openai').split(','),
    derivativePriority: optional('AI_DERIVATIVE_MODEL_PRIORITY', 'groq,openai,cerebras').split(','),
    // Indexed 0-4, corresponding to _1 through _5 — an entry is `undefined`
    // if that numbered key isn't configured. See numberedProviderKeys()'s
    // comment above for why these stay optional/variable-count rather than
    // using required().
    providerKeys: {
      cerebras: numberedProviderKeys('CEREBRAS_API_KEY'),
      groq: numberedProviderKeys('GROQ_API_KEY'),
      openai: numberedProviderKeys('OPENAI_API_KEY'),
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
