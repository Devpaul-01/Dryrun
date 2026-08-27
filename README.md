# DryRun

**A sales-practice simulator: describe what you sell, practice the hard conversation against an AI buyer built for your product, get an honest read on what's actually working.**

**Status:** API and background-worker backend complete. Mobile client (Expo/React Native) in active development against this API.

---

## What this is

You're a founder or a new sales hire and you're about to do outbound for the first time, or you have one specific hard conversation coming up — a skeptical buyer, a price objection, a prospect who's gone quiet. DryRun lets you practice that exact conversation, as many times as it takes, against a buyer persona generated from your actual product and audience — not a generic chatbot, and not a colleague who's tired of playing the villain.

A session runs in real time: the buyer's reply, their private internal monologue (revealed after the session), and a live interest/trust reading all update every turn from one structured AI call. When it ends, you get a six-axis skill score, a specific coaching debrief, and — if you retry the same scenario — an exact numeric comparison against your first attempt.

The full backend for this — API, five background-job queues, AI provider fallback, billing, real-time status channels — is built and working. The mobile client is what I'm building next.

## The problem

Sales pitches fail in a specific, nameable way, and you usually only find out live, with a real prospect, when it's too late to try a different line. Role-playing with a colleague helps until they get tired of being the skeptical buyer. What's actually missing is a repeatable version of the hard conversation, with an honest read on what changed between attempts.

## What I actually built

- **A live-turn AI conversation engine** where every message exchange returns, in one validated structured response, an in-character reply, a private monologue, a signed interest/trust/confusion delta, buying-intent and objection-likelihood scores, and a goal-achievement judgment — with strict schema validation, a bounded retry on failure, and a neutral fallback if the retry also fails, so a malformed model response never reaches the user as a broken reply.
- **A three-provider AI fallback chain** (Cerebras, Groq, OpenAI — up to five keys each) with Redis-backed cooldowns and an atomic per-workspace daily budget enforced via a Lua script, so two concurrent calls for the same workspace can't both slip past the budget check.
- **A persona-ingestion pipeline** that builds a buyer character from pasted text, a public URL, or an uploaded document (PDF/DOCX/image-via-OCR) — async extraction and synthesis, live status pushed over a Supabase Realtime channel that's authorized at the database layer, not just by what the API chooses to publish.
- **Five BullMQ queues, twenty-one job handlers, seven cron schedules** — debrief/scoring generation, skill-trend and curriculum recomputation, weekly summaries, renewal dunning, account purges, a cursor-paginated dead-letter feed merged correctly across all five queues using timestamp watermarks instead of a naive rank offset (which breaks under concurrent writes — this one doesn't).
- **A concurrency bug found and fixed at the database level**: message ordering used to race under concurrent requests for the same session; it's now an atomic Postgres RPC, not a client-side read-then-increment.
- **Request-level idempotency** via a claim-based Redis primitive (not a naive check-then-write, which has its own race condition) so a client retry after a dropped response can never double-submit a message or double-generate a playbook.
- **Billing reconciliation as a single atomic Postgres RPC** called identically from checkout confirmation and webhook processing, keyed on an exact transaction reference rather than "most recent pending subscription" — closing a real cross-tenant misattribution bug where one workspace's payment webhook could have activated a different workspace's subscription.

## Architecture, briefly

```
Mobile Client (Expo — in progress)
        │  HTTPS / JSON, Bearer JWT
        ▼
   Express API  ──┬──►  Supabase Postgres  (system of record)
        │          ├──►  Redis  (cache · rate limits · locks · queue state)
        │          └──►  Supabase Storage  (uploads)
        │
   enqueue jobs
        ▼
  5 BullMQ queues ──► workers ──► Cerebras / Groq / OpenAI, Flutterwave, Expo Push, Resend
```

Three interchangeable startup modes from one codebase — `server.js` (API only), `jobs/index.js` (workers only), `start-all.js` (both, one process) — with zero duplicated logic between them.

Full write-up, including the AI validation pipeline, the sequence-index race and its fix, billing reconciliation, and the caching/invalidation design: **[ARCHITECTURE.md](./ARCHITECTURE.md)**.
Product workflows and the reasoning behind them: **[PRODUCT_OVERVIEW.md](./PRODUCT_OVERVIEW.md)**.

## Engineering highlights

- **Structured AI output is never trusted on receipt.** Zod-validated against strict numeric bounds; a validation failure triggers exactly one stricter retry, then falls back to a neutral response — every attempt, whatever the outcome, is logged to an evaluations table that backs the whole scoring-integrity story.
- **Prompt-injection defense is structural, not just a system-prompt instruction.** User content is delimited and labeled as data in every prompt, but the real second line of defense is that an injected instruction still has to survive strict schema/range validation to take effect.
- **Two genuinely different idempotency problems get two genuinely different fixes**: BullMQ job IDs for job-level dedup, a claim-based Redis primitive for request-level dedup — because a naive shared-cache check-then-write has the same race condition the budget check does, and both are fixed with the same atomic-Lua-script pattern.
- **Cache invalidation is tag-based where the affected key set is unbounded** (every cached page of a user's session list) and direct where it's known exactly (one persona's own cache entry) — one shared utility, not per-route reinvention.
- **Retries never regenerate the buyer.** An earlier version did, which meant a "before/after" comparison was silently comparing two different personas — fixed by explicitly carrying the original persona forward into the retry.
- **The privacy boundary between "my session" and "team aggregate" is structural.** The aggregate team-progress query is backed by a separate code path that never joins against the tables holding individual transcripts — an admin literally cannot query their way into a member's session content by accident, because the query that returns aggregates has no columns to leak it through.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+, Express 4, TypeScript (strict mode) |
| Database | Supabase (Postgres), via `@supabase/supabase-js` — service-role client |
| Cache / queues / locks | Redis (`ioredis`), BullMQ |
| Validation | Zod |
| AI providers | Cerebras, Groq, OpenAI — OpenAI-compatible chat-completions interface, one adapter for all three |
| Auth | Supabase Auth (email/password + Google OAuth), JWT bearer tokens |
| File storage | Supabase Storage, signed upload/download URLs |
| Malware scanning | ClamAV (`clamscan`) |
| Payments | Flutterwave, behind a provider-agnostic interface |
| Push / email | Expo Server SDK, Resend / SMTP / console (env-selected) |
| Analytics | PostHog + a parallel Postgres `analytics_events` table |
| Logging / errors | Pino (structured JSON), Sentry |
| Mobile client (in progress) | Expo / React Native |

## Repository structure

```
config/       Supabase, Redis, env, logger, cache, system-config clients — single source per concern
jobs/         Queue registry, scheduler, 21 worker handlers
lib/          Cross-cutting helpers: pagination, idempotency, rate limiting, ApiError
middleware/   requestId → securityHeaders → authenticate → resolveWorkspace → rateLimit → validate
modules/      One folder per domain (auth, billing, practice, coaching, files, ai, ...) —
              each with its own routes.ts / service.ts / schemas.ts
realtime/     Supabase Realtime channel publishing conventions
app.ts        Express app assembly, route mounting, no listen()
server.ts     API-only entry point
start-all.ts  Combined API + worker entry point
schema.sql    Full database schema, reverse-engineered and documented from every query in the codebase
```

## Setup

```bash
npm install
cp .env.example .env   # see required variables below
npm run dev             # API only, tsx watch
npm run dev:worker      # workers only
npm run dev:all         # both, one process
```

### Required environment variables

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
REDIS_URL
FRONTEND_URL
```

Everything else (AI provider keys, Flutterwave keys, email provider, PostHog, Sentry, ClamAV host) is optional and feature-gates gracefully — the app boots without them, with the corresponding feature disabled or, for AI providers specifically, a smaller effective fallback chain. See `config/env.ts` for the complete list and defaults.

### Build & run

```bash
npm run build       # tsc → dist/
npm start            # node dist/server.js
npm run start:worker # node dist/jobs/index.js
npm run start:all    # node dist/start-all.js
```

## Current gaps, stated plainly

- **No automated test suite yet** — `npm test` is a placeholder. This is the most honest gap in the current backend.
- **Mobile client doesn't exist yet.** The API contract is stable and this backend has been exercised through it during development, but there's no UI to point at yet.
- **RLS is enabled everywhere but isn't the enforcement boundary** — the service-role client bypasses it by design; workspace-scoping in application code is the real authorization check today, with RLS as a documented, deliberate last line of defense.

## What's next

- Building out the Expo client against this API.
- Test coverage, starting with the AI-output-validation pipeline and the billing-reconciliation RPC paths — the two places a silent regression would be most expensive.
