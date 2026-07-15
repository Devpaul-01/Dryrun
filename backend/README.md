# DryRun Backend

Production backend for DryRun — an AI sales conversation rehearsal platform.
Implements the architecture defined in `dryrun-architecture-01` through
`-07` (see the project's architecture document set), merged with the
production codebase generation brief.

## Stack

Express.js + TypeScript, PostgreSQL via Supabase (Auth + Storage +
Realtime), Redis + BullMQ, a multi-provider AI fallback chain (Cerebras /
Groq / OpenAI), Flutterwave (behind a provider-agnostic interface), Expo
Push, PostHog, Sentry.

## Getting started

```bash
npm install
cp .env.example .env   # fill in real values
```

Apply database migrations in order — see `src/db/migrations/README.md`.
Create the `dryrun-uploads` Supabase Storage bucket (private, signed-URL
access only).

```bash
npm run dev          # API server, hot-reload
npm run dev:worker    # background job workers, separate process
```

Production:

```bash
npm run build
npm start             # API
npm run start:worker  # workers -- deploy as a separate process/service
```

## Architecture map

| Concern | Where |
|---|---|
| Global middleware stack (request ID -> security headers -> rate limit -> auth -> workspace -> role -> entitlement -> validation -> handler -> error handler -> logging) | `src/middleware/*`, assembled in `src/app.ts` |
| Auth (email/password, Google OAuth, password reset, blocking email verification for all signup paths including OAuth) | `src/modules/auth/` |
| Workspaces, roles, invites, privacy-safe aggregate team progress | `src/modules/workspace/` |
| Practice sessions ("chats": rename/archive/search, deliberately NO edit-message/regenerate-response), personas (incl. document/URL ingestion pipeline), live-turn AI loop | `src/modules/practice/` |
| AI provider abstraction, prompt construction (prompt-injection defended), output validation/reject-retry (the scoring-integrity pipeline), async consistency check | `src/modules/ai/` |
| Debriefs, skill scoring, curriculum, badges, playbooks (versioned, shareable) | `src/modules/coaching/` |
| Billing: Flutterwave provider, entitlement functions, webhook handling | `src/modules/billing/` |
| Uploads: signed URLs, AV scan, text extraction (PDF/DOCX/URL/OCR stub) | `src/modules/files/` |
| Notifications: email, Expo Push, in-app log | `src/modules/notifications/` |
| Analytics: dual-write to Postgres + PostHog | `src/modules/analytics/` |
| Demo mode (anonymous, capped, converts into a real account with pre-filled onboarding) | `src/modules/demo/` |
| Admin tooling, health checks | `src/modules/admin/`, `src/modules/health/` |
| Background jobs: queues, all workers, cron scheduler | `src/jobs/` |
| Database schema | `src/db/migrations/*.sql` |

## What's genuinely implemented vs. what needs attention before "thousands of users"

Being direct about this rather than overclaiming, per the brief's own
emphasis on correctness over speed:

**Fully implemented, real logic (not stubs):**
- The entire live-turn conversation loop, including the schema validation
  -> reject-retry -> neutral-fallback pipeline and the
  `ai_scoring_evaluations` audit log -- this is the product's core
  mechanism and got the most care.
- Entitlements as named functions behind a global enforcement toggle.
- Flutterwave checkout, webhook verification/processing, and the explicit
  scheduled-job renewal model (not assumed provider-side auto-recur).
- The full demo -> conversion flow, including pre-filled onboarding.
- Cursor pagination, the full middleware stack, RLS policies for the
  privacy-sensitive tables.
- The new conversation-summarization background job (context replacement
  for long sessions), fully wired: trigger, worker, storage, and its use in
  building the live-turn prompt.

**Implemented but narrower than a mature production system would want --
flagged explicitly rather than silently left thin:**
- `extractTextFromImage` (OCR) is a stub that returns an empty string with a
  logged warning -- wiring a real vision-capable provider call in is
  mechanical (the fallback chain already supports it) but wasn't filled in,
  to avoid guessing at a specific vision API contract you haven't chosen.
- The async scoring-consistency classifier (`scoringConsistency.ts`) uses a
  simple keyword-based tone read, exactly as the architecture doc specified
  ("a cheap heuristic, not a second AI call") -- if you later want higher
  precision here, that's a deliberate upgrade decision, not a bug fix.
- Playbook "regenerate incorporating latest sessions" re-grounds from the
  existing version's content rather than re-querying fresh session data --
  functional, but the richer version (pull the N most recent sessions
  against the same persona) is a straightforward follow-up.
- No automated tests, per explicit instruction.
- TypeScript's supabase-js query builder typing is occasionally loosened
  with `as any` at chained-filter call sites where the builder's generic
  inference gets in the way -- this is a common, accepted pattern with this
  library, not a correctness issue, but run `npm run typecheck` after
  `npm install` and expect to smooth over a handful of these as you extend
  queries.

## Security posture implemented

RLS enabled and policy-protected for every privacy-sensitive table (own
transcripts never visible to other workspace members regardless of role);
mandatory AV scan before any upload is processed; structural
prompt/instruction separation plus strict schema validation on every AI
response (defense in depth against prompt injection); webhook signature
verification with a separate failure log for spike detection; per-user and
per-workspace AI budget enforcement; least-privilege intent documented
throughout for background workers vs. the API's service-role key (wire
actual separate DB roles at your hosting/Supabase project level -- this
code assumes it, but role provisioning itself is an infra step outside
application code).

## Product analytics: PostHog

Chosen over Mixpanel/Amplitude for three reasons: self-hostable later if a
third-party data processor for conversation-adjacent analytics ever becomes
a compliance concern (same SDK, no migration); a free tier appropriate for
a pre-revenue product; and a minimal Node SDK that fits the fire-and-forget
event pattern used throughout (`src/modules/analytics/analytics.service.ts`
never lets a PostHog outage affect the request that triggered an event).

## Deliberate omissions (by product decision, not oversight)

- `PATCH /sessions/:id/messages/:id` (edit message) and
  `POST /sessions/:id/messages/:id/regenerate` do not exist, and
  `session_messages` has no `edited_at`/`is_regenerated` column at all --
  this is structural, not just an API-layer rule, per the explicit
  clarification that rewriting the historical record undermines the
  product's core value.
- No Cloudinary anywhere -- Supabase Storage throughout, per the same
  clarification round.
- No token-by-token streaming anywhere -- the live-turn response is always
  a single validated structured object, synchronized with the live score
  panel, per the same clarification round.
