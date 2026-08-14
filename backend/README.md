# DryRun Backend

API and background-worker backend for DryRun — a sales practice/coaching
platform. Founders practice cold outreach, objection handling, and
negotiation against an AI-generated buyer persona, then get scored coaching
feedback. This repo is the backend only; the client is a separate Expo
(React Native) mobile app.

## Stack

- **Runtime:** Node.js 20+, TypeScript
- **API:** Express
- **Database:** Postgres via Supabase (service-role access; RLS as a
  defense-in-depth layer, not the primary authorization boundary — see
  `config/supabase.ts`)
- **Queues/scheduling:** BullMQ on Redis
- **Cache/locks/rate-limiting:** Redis (`config/redis.ts`, `config/cache.ts`)
- **AI:** a provider-agnostic fallback chain across Cerebras/Groq/OpenAI
  (`modules/ai/fallbackChain.ts`)
- **Payments:** Flutterwave (behind a provider interface —
  `modules/billing/paymentProvider.interface.ts` — so a second provider is a
  contract implementation, not a rewrite)

## Architecture at a glance

- `app.ts` — Express app, middleware stack, route mounting. `server.ts` boots
  it.
- `modules/*` — one folder per domain (auth, billing, coaching, files,
  practice, workspace, etc.), each with `*.routes.ts` (HTTP layer) and
  `*.service.ts` (business logic + DB access). Routes never touch Supabase
  directly for anything non-trivial; services do.
- `jobs/*` — BullMQ queue definitions, the scheduler (cron-style repeatable
  jobs via BullMQ's Job Scheduler API), and every background worker handler
  under `jobs/workers/`.
- `middleware/*` — the global request pipeline: request ID, security
  headers, rate limiting, auth, workspace resolution, role/entitlement
  gates, validation, route handler, error handler. The exact order is
  documented step-by-step in each middleware file's own header comment.
- `config/*` — typed, centralized environment config, plus the Redis/Supabase/
  cache/logger singletons every other module imports from.
- `db/schema.sql` — the definitive Postgres schema (see "Database setup"
  below).

### Three ways to run it

This backend can run as one process or two, depending on how much
operational complexity you want:

| Entrypoint | What it does | When to use it |
|---|---|---|
| `server.ts` | API only | Production at real scale — API and workers scale independently; an AI-queue backlog spike doesn't require redeploying the API. |
| `jobs/index.ts` | Workers only (all 5 queues + the scheduler) | Paired with `server.ts` above for that same independent-scaling setup. |
| `start-all.ts` | API + all workers, one process | Simpler deployments — a single small VM/container, staging, or local dev where running two processes is unnecessary overhead. |

All three are graceful-shutdown aware (drain in-flight HTTP requests or
in-flight jobs before exiting on `SIGTERM`/`SIGINT`) and safe to run as
multiple replicas of the same mode simultaneously — every piece of shared
state (rate limits, caches, distributed locks, the AI budget counter, the
job scheduler) is Redis-backed and safe under concurrent instances, not
in-process memory. See inline comments in `config/redis.ts` and
`jobs/scheduler.ts` for the specific mechanisms.

## Setup

### 1. Prerequisites

- Node.js 20+
- A Supabase project (Postgres + Auth)
- A Redis instance (local via Docker, or hosted — Upstash, Redis Cloud, etc.)
- A ClamAV daemon reachable from wherever this runs, for the upload
  malware-scan step (`docker run -p 3310:3310 clamav/clamav` works for local
  dev)

### 2. Install and configure

```bash
npm install
cp .env.example .env
# fill in .env — see the file's own comments for what's required vs. optional
```

### 3. Database

Run `db/schema.sql` against your Supabase project's Postgres database (via
the Supabase SQL editor, or `psql`). It's a single, complete schema file —
tables, indexes, RLS policies, and triggers, dependency-ordered so it runs
top-to-bottom on an empty database. There's no incremental migration
history yet; this file **is** the schema.

### 4. Supabase Auth configuration

Two things need to be set up in the Supabase dashboard beyond the schema
itself, since they're config, not SQL:

1. **Send Email Hook** (Authentication -> Hooks -> Send Email): register
   this backend's `POST /api/v1/auth/email-hook` endpoint as an HTTPS hook,
   then copy the secret it gives you into `SUPABASE_SEND_EMAIL_HOOK_SECRET`.
   This is what makes password-reset emails actually send — see
   `modules/auth/emailHook.service.ts`'s header comment for exactly why this
   mechanism exists (short version: `admin.createUser()`, which this backend
   needs for server-side signup, never triggers Supabase's own email
   sending — no combination of settings changes that — so signup
   confirmation and password reset each need their own specific mechanism,
   documented in that file).
2. **Google OAuth provider** (Authentication -> Providers -> Google), if you
   want Google sign-in — configure your own Google OAuth client credentials
   there.

### 5. Run it

```bash
npm run dev          # API only, hot-reload
npm run dev:worker   # workers only, hot-reload
npm run dev:all      # combined, hot-reload
```

or, built:

```bash
npm run build
npm start             # API only
npm run start:worker  # workers only
npm run start:all     # combined
```

Health checks: `GET /health` (liveness), `GET /health/ready` (readiness —
checks DB and Redis connectivity), `GET /health/deep` (includes queue
depths).

## Connecting the Expo app

This repo is backend-only; the mobile client lives in a separate Expo
project. Three things the Expo app needs to know about this backend:

1. **API base URL** — point the Expo app's API client at wherever this
   backend is deployed (`http://localhost:3001` for local dev against the
   default `PORT`).
2. **OAuth deep link** — `FRONTEND_URL_MOBILE_SCHEME` (default
   `dryrun://auth-callback`) must match the URL scheme registered in the
   Expo app's `app.json`/`app.config.ts` (the `scheme` field). This is what
   lets a completed OAuth flow hand control back to the app instead of
   leaving the user stuck in a browser tab. Per
   `modules/auth/auth.routes.ts`'s own comment: mobile clients use
   `expo-auth-session` directly against Supabase Auth's OAuth endpoint with
   a platform-computed redirect URI, not this backend's `/auth/google/start`
   route — that route is the *web* OAuth flow's entrypoint only.
3. **Push notifications** — set `EXPO_ACCESS_TOKEN` (from your Expo
   project, for sending push notifications via `expo-server-sdk` — see
   `modules/notifications/push.service.ts`). The Expo app registers its
   push token by calling `POST /api/v1/notifications/push-token` once the
   user grants notification permission client-side.

Every other integration point is a normal authenticated REST call — Bearer
JWT from Supabase Auth, `x-workspace-id` header for a user in more than one
workspace (defaults to their current workspace otherwise). See
`middleware/authenticate.ts` and `middleware/resolveWorkspace.ts` for the
exact contract.

## AI providers

Set at least one provider's `_1` key (`CEREBRAS_API_KEY_1`, `GROQ_API_KEY_1`,
or `OPENAI_API_KEY_1`) for the app to function at all — every AI-dependent
feature (live conversation turns, persona generation, debriefs, scoring,
playbooks) goes through the fallback chain in
`modules/ai/fallbackChain.ts`, which needs at least one configured provider
in whichever priority list (`AI_LIVE_TURN_MODEL_PRIORITY` /
`AI_DERIVATIVE_MODEL_PRIORITY`) it's building. OpenAI specifically is also
needed for image-based persona-source OCR
(`modules/files/extraction.service.ts`), which calls a vision-capable model
directly rather than through the fallback chain.

## Known limitations

Being upfront about where this stands, rather than letting a reviewer
discover it themselves:

- **No automated test suite yet.** Every fix and feature in this codebase's
  history was verified via real TypeScript compilation against the actual
  dependency versions (not mocked), plus targeted runtime simulations for
  concurrency-sensitive logic (documented inline at each such fix) — but
  that's not a substitute for a real test suite, which is in progress
  separately.
- **No CI pipeline configured yet** (lint/typecheck/test-on-PR).
- **No Dockerfile yet** — the three entrypoints above run directly via
  Node; containerizing them is a natural next step for real deployment.
- **`addSeats` (billing.service.ts) has no payment step** — a workspace
  admin/owner can add seats without an actual charge. Documented explicitly
  in that function's own comment: building real seat billing needs a
  per-seat price on the plan model (doesn't exist yet) and a proration
  policy, which are product decisions, not implementation gaps to quietly
  paper over.
- **Session-goal-achievement and session-comparison are recently added**
  and haven't seen real usage volume yet — the logic is verified by
  compilation and hand-traced simulation, not production traffic.

## Migration history / commit structure

This backend went through a deliberate, staged hardening pass — caching,
cursor pagination, horizontal-scalability fixes, a full authorization audit
across every route in the codebase, and several feature builds — each
staged as its own small, reviewable commit rather than one large diff. If
you're looking at the commit history and wondering why there are ~26
sequential, narrowly-scoped commits with unusually detailed messages: that's
why. It's not scope creep, it's a deliberate choice to make the history
itself readable.
