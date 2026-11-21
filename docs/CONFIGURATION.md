# Configuration Reference

Every environment variable the DryRun backend and mobile client read, what it does, and what happens when it is missing.

**Source of truth:** `backend/src/config/env.ts` (backend) and `frontend/src/config/env.ts` (client). Nothing else in the backend reaches into `process.env` directly. Templates: [`backend/.env.example`](../backend/.env.example) and [`frontend/.env.example`](../frontend/.env.example).

> **Missing required variables fail late, not at boot.** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `REDIS_URL` are accessor functions in `env.ts` that throw on first call, and the Supabase and Redis clients are created lazily. A process with one of them unset starts normally and fails on its first database or Redis operation. After booting, check `GET /health/ready`, which pings both.

---

## 1. Backend

### 1.1 Required

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | `config/supabase.ts` | Project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | `config/supabase.ts` | Service-role key. It bypasses RLS and must stay on the API and worker tiers — never ship it to a client. |
| `REDIS_URL` | `config/redis.ts` | One shared connection backs BullMQ, rate limiting, the cache, the AI budget counter, idempotency claims and the narrow distributed locks. See [BACKGROUND_JOBS.md §6](./BACKGROUND_JOBS.md#6-redis-usage). |

### 1.2 Application

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | Logged at startup. Also switches on a production-only warning when Flutterwave keys are missing (§1.5). |
| `PORT` | `3001` | HTTP listener port (`server.ts`, `start-all.ts`). |
| `LOG_LEVEL` | `info` | Pino level (`config/logger.ts`). |
| `FRONTEND_URL` | `http://localhost:5173` | **Optional.** Used to build links in emails (verification, billing) and as a CORS-allowed origin. Localhost `:5173` and `:3000` are always allowed in addition to this value. |
| `ADMIN_ALLOWLIST_IPS` | empty | Comma-separated. When non-empty, `requireAdmin` rejects any admin request whose `req.ip` is not in the list. It is an exact-match list (no CIDR) layered on top of the per-request `is_admin` database check. `trust proxy` is set to `1`, so `req.ip` is the first forwarded address. |

### 1.3 Supabase Auth

| Variable | Default | Notes |
|---|---|---|
| `SUPABASE_SEND_EMAIL_HOOK_SECRET` | empty | The `v1,whsec_<base64>` secret from Authentication → Hooks → Send Email. Used to verify `POST /api/v1/auth/email-hook` (Standard Webhooks, HMAC over the raw body). Without it the hook endpoint answers with an error, so password-reset emails are not sent. See `modules/auth/emailHook.service.ts`. |

### 1.4 AI providers

At least one `*_API_KEY_1` must be set for any AI feature to work (live turns, persona synthesis, debriefs, scoring, playbooks).

| Variable | Default | Notes |
|---|---|---|
| `CEREBRAS_API_KEY_1` … `_5` | unset | Up to five independent keys per provider; each unset slot is skipped. |
| `GROQ_API_KEY_1` … `_5` | unset | As above. |
| `OPENAI_API_KEY_1` … `_5` | unset | As above. Image-based persona-source OCR calls OpenAI directly using key `_1` only, outside the fallback chain (`modules/files/extraction.service.ts`). |
| `AI_LIVE_TURN_MODEL_PRIORITY` | `cerebras,groq,openai` | Provider order for live conversation turns (fastest first). |
| `AI_DERIVATIVE_MODEL_PRIORITY` | `groq,openai,cerebras` | Provider order for debriefs, scoring, persona synthesis, playbooks, comparisons. |
| `DEFAULT_AI_DAILY_BUDGET_USD_PER_WORKSPACE` | `5` | Per-workspace daily spend ceiling, enforced atomically by a Redis Lua script (`modules/ai/fallbackChain.ts`). Parsed as an integer, so `2.5` is not representable. |

### 1.5 Billing (Flutterwave)

| Variable | Default | Notes |
|---|---|---|
| `FLUTTERWAVE_PUBLIC_KEY` | empty | |
| `FLUTTERWAVE_SECRET_KEY` | empty | |
| `FLUTTERWAVE_WEBHOOK_SECRET_HASH` | empty | Static pre-shared hash, compared against the `verif-hash` request header (`modules/billing/providers/flutterwave.provider.ts`, `webhook.routes.ts`). |
| `DEFAULT_PAYMENT_ENFORCEMENT_ENABLED` | `false` | Boot-time default for the `payment_enforcement_enabled` flag. At runtime the value in the `system_config` table wins (cached in Redis for 30 s, invalidated when an admin changes it via `PATCH /api/v1/admin/system-config/:key`). When off, every entitlement check still runs, always allows the action, and records a `feature_gate_bypassed` analytics event so you can see how many people would have hit the gate. |

With `NODE_ENV=production` and any of the three Flutterwave keys missing, `env.ts` prints a warning with `console.warn` (it cannot use the logger without a circular import) but does not exit.

### 1.6 Email and push

| Variable | Default | Notes |
|---|---|---|
| `EMAIL_PROVIDER` | `console` | `console` (logs the message), `smtp`, or `resend`. |
| `EMAIL_FROM` | `noreply@dryrun.app` | |
| `RESEND_API_KEY` | empty | Needed when `EMAIL_PROVIDER=resend`. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | empty / `587` / empty / empty | Needed when `EMAIL_PROVIDER=smtp`. |
| `EXPO_ACCESS_TOKEN` | empty | Expo push access token (`modules/notifications/push.service.ts`). |

### 1.7 Observability and file scanning

| Variable | Default | Notes |
|---|---|---|
| `SENTRY_DSN` | empty | Sentry is initialised only when set (`app.ts`), with `tracesSampleRate: 0.1`. |
| `SENTRY_ENVIRONMENT` | `development` | |
| `POSTHOG_API_KEY` | empty | Product analytics. |
| `POSTHOG_HOST` | `https://app.posthog.com` | |
| `CLAMSCAN_HOST` | `127.0.0.1` | ClamAV daemon host. If it is unreachable, uploads are **rejected**, not skipped (`modules/files/avScan.service.ts`). |
| `CLAMSCAN_PORT` | `3310` | |

### 1.8 Declared but not currently read

These appear in `env.ts` or `.env.example` but no other backend module consumes them today. Setting them has no effect; they are listed so nobody hunts for the code path.

| Variable | Status |
|---|---|
| `SUPABASE_ANON_KEY` | Parsed into `env.supabase.anonKey`, never read. The backend uses the service-role client only. |
| `SUPABASE_JWT_SECRET` | Parsed into `env.supabase.jwtSecret`, never read. Tokens are verified with `supabase.auth.getUser()`, a network call to Supabase Auth, not locally. |
| `FRONTEND_URL_MOBILE_SCHEME` | Parsed into `env.frontendMobileScheme`, never read. The mobile OAuth redirect is built client-side by `expo-auth-session`; the scheme that matters is `scheme` in `frontend/app.json` (`dryrun`). |
| `DEFAULT_FREE_SESSION_LIMIT_PER_MONTH` | Parsed, never read. The session limit comes from `plans.session_limit_per_month` in the database (`modules/billing/entitlements.ts`). |
| `DEFAULT_SESSION_ATTACHMENT_CAP` | Parsed, never read. |
| `GOOGLE_OAUTH_WEB_REDIRECT_URL`, `GOOGLE_OAUTH_MOBILE_REDIRECT_SCHEME` | In `.env.example` only; not in `env.ts`. Google sign-in is configured in the Supabase dashboard. |

---

## 2. Mobile client

All client variables are `EXPO_PUBLIC_*`, inlined into the JavaScript bundle at build time. **Never put a secret here.**

| Variable | Required | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Yes | Backend origin without `/api/v1` (the client appends it) and without a trailing slash. Startup throws a descriptive error if it is missing. For a physical device this must be reachable from the phone, not `localhost`. |
| `EXPO_PUBLIC_SUPABASE_URL` | No, but see note | Must match the backend's `SUPABASE_URL`. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | No, but see note | The project's anon (public) key. |
| `EXPO_PUBLIC_SHARE_BASE_URL` | No | https origin that hosts shared playbook pages; links become `<origin>/playbook/<token>`. When empty, shares use the app deep link `dryrun://playbook/<token>`. The backend serves only the JSON endpoint `GET /api/v1/public/playbooks/:token`, not a hosted page. |

The Supabase client (`frontend/src/lib/supabaseClient.ts`) is only constructed when **both** Supabase variables are set. It is used for exactly two things — the persona-generation status Realtime channel and the Google sign-in PKCE flow — so a build without them still runs, minus those two features. Everything else goes through the DryRun API.

Maestro smoke flows additionally read `MAESTRO_EMAIL` and `MAESTRO_PASSWORD` from the shell — see [`frontend/.maestro/README.md`](../frontend/.maestro/README.md).

---

## 3. Test environment

| Variable | Default | Notes |
|---|---|---|
| `TEST_DATABASE_URL` | `postgresql://postgres:postgres@127.0.0.1:5432/postgres` | Admin connection used by the billing-reconciliation suite to create and drop its own throwaway database. CI sets it explicitly. See [`backend/test/README.md`](../backend/test/README.md). |
| `TEST_DB_NAME` | `dryrun_vitest` | Name of the throwaway database. |
