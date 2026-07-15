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
  },

  redisUrl: () => required('REDIS_URL'),

  ai: {
    liveTurnPriority: optional('AI_LIVE_TURN_MODEL_PRIORITY', 'cerebras,groq,openai').split(','),
    derivativePriority: optional('AI_DERIVATIVE_MODEL_PRIORITY', 'groq,openai,cerebras').split(','),
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
