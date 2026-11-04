# Backend Audit — Pass 1

Date: 2026-10-30
Scope: `backend/` (Express/TS API + BullMQ workers), plus top-level `db/` and duplicated `backend/db/`.

This is a first-pass audit, not a line-by-line review of all ~90 source
files. It covers install/build/typecheck health, dependency security,
and schema/migration consistency — the things that block or undermine
everything else. Module-by-module logic review (auth, billing RPCs,
AI validation pipeline, RLS policies) is proposed as follow-up milestones
in IMPLEMENTATION_PLAN.md rather than done here.

## 1. Install is currently broken (blocker)

`backend/package.json` declares `"expo-server-sdk": "^3.19.0"`. No such
version exists on the npm registry — the 3.x line tops out at 3.15.0; the
package is now at major version 8. `npm install` fails outright with
`ETARGET`. This means the repo cannot be installed, built, or run from a
clean checkout today, despite the README's "API and background-worker
backend complete" status claim.

Usage in `src/modules/notifications/push.service.ts` (constructor,
`isExpoPushToken`, `chunkPushNotifications`, `sendPushNotificationsAsync`)
is stable across the whole 3.x–8.x range, so this is a low-risk pin fix,
not an API migration. Proposed: pin to `^3.15.0` (last real 3.x) as the
minimal fix; a deliberate upgrade to 8.x is separate, larger-risk work
(major version jump, different changelog) and out of scope for the fix
commit.

## 2. Dependency vulnerabilities (npm audit: 1 critical, 5 high)

All are transitive, not direct pins the project controls directly except
via upgrading the parent:

| Package | Severity | Via | Notes |
|---|---|---|---|
| `proxy-addr` | **Critical** | `express@4.22.2` | IPv4-mapped IPv6 trust-subnet spoofing. **Directly relevant**: `app.ts:47` sets `app.set('trust proxy', 1)`, so this is live attack surface for anything that trusts `req.ip` (rate limiting, audit logs). |
| `nodemailer` | High | direct dep (`^7.0.0`) | Long CVE list: SMTP command injection, CRLF header injection, SSRF via `disableFileAccess`/`disableUrlAccess` bypass, auth-bypass via IDN/punycode allowlist bypass. Used in `notifications/email.service.ts`. |
| `body-parser` | High | `express@4.22.2` | DoS via trailing bytes after compressed body. |
| `follow-redirects` | High | `axios@1.21.0` | Credential-header leak across redirects (affects any outbound `axios` call, e.g. AI providers, persona URL ingestion). |
| `@xmldom/xmldom` | High | `mammoth@1.12.0` | XML injection / ReDoS — relevant to DOCX persona-source ingestion. |
| `zod` | High | direct dep | Memory exhaustion validating oversized constrained collections — relevant given Zod validates both API input and AI structured output. |

None of these are fixed by patch-level bumps within the current majors
(verified: `npm audit fix` without `--force` resolves nothing here).
Addressing them means either an Express 5 migration (large, affects
every route) or waiting on express 4.x point releases, for
`proxy-addr`/`body-parser`; and major-version bumps for `nodemailer`,
`axios`'s `follow-redirects`, `mammoth`, and `zod`. These are real
vulnerabilities worth separate, reviewed milestones — not safe to bundle
into one mass `npm audit fix --force`, which the mission doc's own
"don't weaken assertions to go green" spirit argues against doing
blindly.

## 3. Three divergent migration directories, numbering collides

Three separate migration folders exist, each independently numbered from
0001 (or 0004) — not duplicates of each other, but three genuinely
different sequential patch sets, each documented against a different
internal audit:

- `backend/src/db/migrations/0001`–`0007` + `README.md` — the base schema
  build-out (extensions → identity/workspace → practice domain → AI
  integrity → billing → notifications/analytics → RLS policies). This
  directory has the only `README.md` describing apply order and
  dependencies, so it reads as the intended source of truth for initial
  schema setup.
- `backend/db/migrations/0001`–`0003` — later, narrower patches (e.g.
  `0001_persona_sources_scenario_type.sql`, explicitly fixing a bug
  referenced as "FINAL_BACKEND_AUDIT.md findings C1/C1a" — that audit
  file is not in this repo).
- `db/migrations/0004`–`0008` (top-level, outside `backend/`) — further
  patches referencing a `BACKEND_API_RECOMMENDATIONS.md` (also not
  present), covering realtime broadcast authorization, payment
  reconciliation columns, and subscription constraints.

The colliding numbers (two different `0001`s, two different `0004`s)
mean "run migrations 0001 through 0007" is now an ambiguous instruction
— a developer or deploy script following only the one README that exists
would miss two directories' worth of real fixes (realtime auth, billing
reconciliation columns, subscription uniqueness constraint).

Consistent with this: there are **three different, diverged `schema.sql`
snapshots** (`backend/schema.sql`, `backend/db/schema.sql`, `db/schema.sql`
— pairwise diffs of 37–88 lines), and no migration-tracking table
(`schema_migrations` or similar) anywhere in any of the SQL — migrations
are tracked by convention/README only, not enforced.

This is an organizational/operational defect, not active data corruption
— each individual file looks internally coherent and well-commented. But
it's a real risk for anyone provisioning a new environment, and it
directly contradicts the "production-ready" bar the mission doc sets.
Proposed fix: consolidate into one numbered sequence under
`backend/src/db/migrations/`, regenerate one canonical `schema.sql` from
it, remove the other two directories and files, and add a real
migration-tracking mechanism (even a minimal `schema_migrations(version
text primary key, applied_at timestamptz)` table + apply script) so this
can't silently drift again.

## 4. No CI, no test runner

- `npm test` is a literal no-op placeholder (`echo ... && exit 0`).
- No test framework (jest/vitest/etc.) in `devDependencies`.
- No `.github/workflows/` or other CI config anywhere in the repo.
- No ESLint config file exists, so `npm run lint` currently fails to run
  at all (not "finds lint errors" — errors out for missing config).

The README is upfront about the missing test suite, which is good, but
"lint script exists but can't run" wasn't previously stated.

## 5. What's healthy

For a project this size, these were genuinely good signs, not just
absence-of-evidence:

- `tsc --noEmit` and `tsc` (build) both pass clean with `strict: true`
  and no `noUnusedLocals`/`noUnusedParameters` escape hatches disabled
  for leniency — the codebase typechecks honestly.
- Module layout (`routes.ts` / `service.ts` / `schemas.ts` per domain) is
  consistent across all ~15 modules inspected at the directory level.
- The architecture docs (`README.md`, `ARCHITECTURE.md`,
  `PRODUCT_OVERVIEW.md`) are specific and match what's in the code at a
  structural level (e.g. the three startup-mode files, five BullMQ
  queues, the migrations README's stated dependency order) — these
  weren't just aspirational docs during this pass.

## Pass 2 — Route-by-route authz/ownership review

Date: 2026-10-31

Reviewed every route module in the app (`auth`, `workspace`, `practice`,
`coaching`, `billing`, `admin`, `files`, `notifications`, `analytics`,
`demo`) against the global middleware chain
(`requestId → securityHeaders → authenticate → resolveWorkspace →
rateLimit → validate`) and, for every `:id`-bearing route, traced the
call chain into its `service.ts` to confirm the underlying query actually
filters by the right combination of `workspace_id`/`user_id` — not just
that the route "looks" protected by virtue of being mounted after
`resolveWorkspace`.

**Result: no live authorization bugs found.** Specifically checked and
confirmed correct:
- `authenticate.ts` / `resolveWorkspace.ts` / `requireRole.ts` /
  `requireAdmin.ts` — JWT verification, soft-delete handling, the
  `x-workspace-id` header path (confirmed it can only select among
  workspaces the caller actually belongs to, not an arbitrary workspace),
  and `requireAdmin` re-querying `is_admin` fresh on every request rather
  than trusting a cached claim.
- `session.routes.ts` — every mutating/reading route funnels through
  `getSessionById` or an equivalent inline check that verifies both
  `workspace_id` and `user_id`; the file's own comments document two
  real cross-tenant bugs (`/goal`, `GET /attachments`) that were already
  found and fixed in this codebase's history, which is itself a good
  sign of prior real review having happened here.
- `billing.routes.ts` — role-gating is consistent and correctly scoped
  (`cancel` requires `owner` specifically, not `admin`, which is the
  right call for a destructive/financial action). One path looked
  suspicious at first — `GET /usage` has no `requireRole` and internally
  calls the same `getCurrentSubscription()` that the owner/admin-gated
  `GET /subscription` uses — but traced it fully: `getUsage()` only
  returns the joined `plans` object (public catalog data, same as the
  unauthenticated `GET /plans`), never the subscription row itself
  (which holds `provider_customer_id`/`provider_subscription_id`). Not
  a leak.
- `admin.routes.ts` / `workspace.routes.ts` — `requireAdmin` IP-allowlist
  + fresh-`is_admin`-check double gate is correctly implemented;
  workspace role-escalation (`updateMemberRole`, `transferOwnership`)
  correctly requires `owner` specifically (an `admin` cannot promote
  themselves); `removeMember` correctly blocks removing the workspace's
  owner without a prior ownership transfer.
- `persona.routes.ts`, `upload.routes.ts`, `notifications.routes.ts`,
  `curriculum.routes.ts`, `badges.routes.ts`, `onboarding.routes.ts`,
  `dashboard.routes.ts` — every resource lookup scopes by the correct
  `workspace_id` and/or `user_id` in the same query as the mutation/read
  itself, not via a separate, differently-scoped check.
- `playbook.routes.ts`'s `publicPlaybookRouter` (mounted unauthenticated
  at `/api/v1/public`) — looked up via a dedicated, separately-generated
  `share_token` column, never the playbook's own primary `id`, and only
  ever populated when a user explicitly makes a playbook shareable. Not
  an enumeration path into private playbooks.
- `demo.routes.ts` (mounted unauthenticated) — demo sessions use a
  server-generated anonymous ID in an httpOnly cookie, never a
  client-suppliable identifier, and are stored in a table entirely
  separate from authenticated-user data. No bridge found into real
  user data.

One process note: an AI-assisted first pass at this same review produced
three "findings" that did not survive independent verification against
the actual source — one cited a route/service-function combination
(`POST /skill-trend/goals`, a `setGoal()` function, a `target_score`
field) that does not exist anywhere in the codebase; another described a
`dismissCurriculum`-adjacent function with a different name and
parameter order than the real one, and claimed a missing `user_id` scope
that the real function actually has, in the same query. Re-verifying
every claim against the primary source directly (not trusting the
sub-review's report) is what caught this before anything was "fixed"
based on a hallucinated gap — worth keeping as the standing practice for
any future delegated security pass.

## Pass 3 — Billing reconciliation RPC: the happy path was broken

Date: 2026-11-01

`reconcile_successful_payment()` is the single Postgres function all three
successful-payment paths call atomically — checkout confirmation
(`billing.service.ts`'s `confirmCheckout`), Flutterwave webhook processing
(`processWebhookEvent.worker.ts`), and renewal charges
(`attemptRenewalCharge.worker.ts`). Rather than trust a read of the SQL
alone, this was verified the same way the migration-consolidation bug in
Pass 1 was found: standing up a real Postgres 16 instance, applying every
migration end-to-end from empty, and actually calling the function with
realistic data. That surfaced two independent, previously-undetected bugs
— both now fixed and mechanically re-verified.

**Finding 1 (most severe): `subscriptions.pending_tx_ref` was never
created by any migration.** The column (and a partial unique index on it)
is referenced throughout the application as though it already exists —
`initiateCheckout` sets it, `confirmCheckout` and the webhook worker match
on it, `attemptRenewalCharge.worker.ts` clears it via the RPC, and
`billing.service.ts`'s own comments describe the index by name as already
present. No migration ever actually created it. Calling the RPC against a
real database failed immediately with `ERROR: column "pending_tx_ref"
does not exist`. This meant every successful-payment reconciliation path
— the entire billing "happy path" — was broken at the database level.
Fixed in a new `src/db/migrations/0012_subscriptions_pending_tx_ref.sql`,
inserted in true dependency order (ahead of the migration that defines
the RPC depending on it), with four subsequent migration files renumbered
to keep the sequence contiguous.

**Finding 2: `reconcile_successful_payment()`'s own `audit_log` insert
had a type mismatch.** With finding 1 fixed, the function got further but
then failed with `ERROR: column "target_id" is of type uuid but
expression is of type text` — the function casts its `p_subscription_id`
parameter to `text` before inserting into `audit_log.target_id`, but that
column is `uuid` (confirmed directly from its `create table audit_log`
definition in `0005_billing_domain.sql`). Checked every other `audit_log`
insert in the codebase (`auth.service.ts`, `workspace.service.ts`,
`billing.service.ts`'s other two call sites, `scheduler.ts`,
`attemptRenewalCharge.worker.ts`) — all pass `target_id` as a raw `uuid`,
never cast to text. This RPC was the one outlier, and because finding 1
blocked the function from ever reaching this line in practice, this bug
was fully masked until the column was added. Fixed by removing the
erroneous `::text` cast in
`src/db/migrations/0013_payment_transactions_columns_and_reconciliation.sql`
(the renumbered file that defines the function).

**Verification**: after both fixes, reset a throwaway database, reapplied
all 16 migrations end-to-end from empty with zero errors, then called
`reconcile_successful_payment()` with realistic seeded data (a workspace,
an `incomplete` subscription with a `pending_tx_ref`) and confirmed the
full resulting state directly: the subscription's `status` flipped to
`active` with `pending_tx_ref` correctly cleared to null, a
`payment_transactions` row was inserted with the correct `card_token` and
`provider_tx_id`, and an `audit_log` row was inserted with a valid `uuid`
`target_id`. `src/db/schema.sql` was regenerated from this corrected,
re-verified database and re-confirmed to apply standalone against a
second fresh database with zero errors, per the same procedure used in
Pass 1.

As a side effect of this review, also found and fixed several stale
migration-number references in code comments — leftovers from the Pass 1
migration-directory consolidation and this pass's renumbering — pointing
at migration numbers that no longer matched the file they described
(`workspace.service.ts`, `resolveWorkspace.ts`, `billing.routes.ts`,
`billing.service.ts`, `session.service.ts`, `persona.service.ts`, and
three worker files). These were documentation-only; no behavior changed.

## Pass 4 — AI output-validation pipeline

Date: 2026-11-02

Reviewed `outputValidator.ts`'s Zod schemas (one per AI call type:
live-turn chat, persona synthesis, debrief, skill scoring, playbook,
session-comparison summary), `parseAndValidate()`, every call site in
`ai.service.ts`, and how each caller handles a validation failure —
specifically whether it has any retry/recovery path or just propagates
the error, and whether that's actually safe for where it's called from.

**Schemas themselves**: well-scoped. Numeric fields are range-bounded
(`state_delta`'s three deltas explicitly clamped to ±15, all 0–100 scores
bounded), `reasoning` fields require a non-empty string rather than
accepting an empty placeholder, and markdown code-fence stripping in
`parseAndValidate` handles the common "model wraps JSON in \`\`\`json"
failure mode before parsing. No gaps found here.

**Retry coverage audit**: `generateBuyerReply` (the live-turn call) is
the only one of the six call types with its own reject→retry→fallback
logic. Checked whether the other five are actually under-protected, or
whether their callers compensate elsewhere:

- `generateDebrief` and `generateSkillScores` are called only from
  background job workers (`generateDebrief.worker.ts`,
  `scoreSessionSkills.worker.ts`), both on the `ai-derivative` queue
  (`attempts: 3`, exponential backoff) with no local try/catch — a
  validation failure propagates and BullMQ genuinely retries the whole
  job. `debrief.service.ts`'s own doc comment confirms this is the
  intended design ("idempotent by design... a retried job never produces
  duplicates"). Correct as-is.
- `generateSessionComparisonSummary` already has its own try/catch in
  `scoring.service.ts`'s `computeSessionComparison`, with a sensible
  deterministic fallback summary sentence — the more important numeric
  comparison is still saved even if the AI summary fails. Correct as-is.
- `generatePersona` called from `synthesizePersona.worker.ts` (a
  background job) deliberately swallows the error rather than rethrowing
  — checked this isn't a bug: `persona.service.ts`'s `updatePersona`
  comment confirms the intended recovery path for a failed synthesis is
  the user manually completing the "failed" placeholder via
  `PATCH /personas/:id`, not an automatic job retry. Correct as-is.
- `generatePlaybookContent` and `generatePlaybookContent`'s regenerate
  path are called synchronously from `POST /playbooks` and
  `POST /playbooks/:id/regenerate` — no retry, but `errorHandler.ts`
  correctly classifies an uncaught `ZodError`/`SyntaxError` as a generic
  500 with no internal details leaked, and a user-initiated HTTP request
  failing with no retry (the user can just click again) is standard,
  acceptable REST behavior. Correct as-is.
- **`generatePersona` called from `demo.service.ts`'s `startDemo` and
  `session.service.ts`'s persona-less session-start path had no retry at
  all** — both are synchronous, user-facing requests, same as the
  playbook routes above, but `startDemo` specifically is an
  **unauthenticated prospect's very first interaction with the
  product** — a single transient AI validation hiccup there was a raw
  500 with no second chance, strictly worse odds than every other AI
  call type gets (either an in-function retry or a background-job
  retry). This asymmetry was real enough to fix rather than just
  document: added the same bounded reject-and-retry shape
  `generateBuyerReply` already uses to `generatePersona` itself (in
  `ai.service.ts`), so both affected call sites are fixed in one place
  with no change to the worker path's existing (correct, intentional)
  swallow-and-mark-failed behavior. Unlike the live-turn retry, a second
  failure here still propagates rather than falling back to a fabricated
  placeholder persona — a generic invented persona would be actively
  misleading in a way a neutral zero-delta chat reply isn't, so letting
  it fail through to each caller's existing handling (worker's catch, or
  a 500 on the synchronous paths) is the safer choice.

Verified the fix doesn't change the validation rules or retry wording
pattern — confirmed `parseAndValidate` genuinely throws on malformed
JSON and on schema-violating (but valid JSON) content, and genuinely
succeeds on a complete valid response, exercising the same three cases
the retry logic depends on. `npm run typecheck`, `build`, and `lint` all
pass clean with no new warnings.

## Pass 5 — Notifications module + a real mobile-readiness bug

Date: 2026-11-02

Reviewed `src/modules/notifications/` in full (`push.service.ts`,
`email.service.ts`, `notifications.service.ts`, `notifications.routes.ts`)
and every call site of `notify()`, as part of a broader pass covering the
areas Pass 1 flagged as not yet reviewed (notifications is also the piece
most directly relevant to the still-unbuilt Expo mobile client — this
review doubled as the mobile-readiness check for push notifications,
since there's no mobile client repo yet to inspect against).

**`notifications.service.ts` / `email.service.ts`**: solid. Every
notification gets a `notifications_log` row first regardless of channel
or delivery success (the audit trail and in-app notification center's
data source), delivery failure is swallowed rather than failing the
triggering job (correct — a push/email hiccup shouldn't fail billing or
AI work), and the `resend` dynamic import is backed by a real declared
dependency. No bugs found.

**Push-token schema/lifecycle — real bug found and fixed**:
`push_tokens` is unique on `(user_id, token)`, not on `token` alone,
which is correct in principle (an Expo push token is tied to one
physical device + app install, not one user, so the same device can
reasonably appear under one user's registration). But nothing ever
removed a token proactively — only reactively, when Expo itself reported
`DeviceNotRegistered`. Neither `/auth/logout` nor `/auth/logout-all`
touched `push_tokens` at all. Reproduced the consequence directly
against a real Postgres table: user A registers a token on a shared
device, logs out (old behavior — no cleanup), user B logs into the same
device and registers the identical token — both rows persist
simultaneously, so **both users would keep receiving each other's push
notifications indefinitely** on any handed-down or shared device, with
no way to ever stop it short of a direct database deletion.

Fixed with two additions to `push.service.ts` — `deregisterPushToken`
(one token) and `deregisterAllPushTokens` (every token for a user) — and
wired them into `auth.routes.ts`: `/logout` now accepts an optional
`pushToken` in the body (the client's own currently-held token; optional
because a web session or a client with push permission denied has none
to send) and deregisters just that one row, matching that it only
revokes the one device's session (`signOut(token, 'local')`);
`/logout-all` deregisters every token for the user, matching that every
session is being revoked there. Verified the fix's exact query shape
directly against Postgres: reproduced the two-rows-same-token state,
then confirmed the logout-time delete removes only the logging-out
user's row and leaves the other user's row untouched.

## Pass 6 — Analytics module

Date: 2026-11-02

Reviewed `src/modules/analytics/` in full (`analytics.service.ts`,
`posthog.client.ts`, `analytics.routes.ts`).

**`analytics.service.ts` / `posthog.client.ts`**: clean. The dual-write
(Postgres + PostHog) is correctly fire-and-forget — each write is
independently try/caught so one backend's outage can't also break the
other, and nothing here can surface as a request failure. `shutdownPostHog`
(needed so PostHog's client-side event buffer actually flushes on exit,
not silently dropped) is correctly wired into both graceful-shutdown
paths (`server.ts`, `start-all.ts`). No bugs found.

**`analytics.routes.ts` — stale/misleading comment, fixed**: the route's
doc comment claimed `POST /analytics/events` accepts "a landing-page CTA
click before any account exists," but that was never actually true — the
route is mounted behind the same authenticated middleware chain as every
other protected route, so an unauthenticated request is rejected before
the handler runs. Confirmed there's no gap this comment was papering
over: the real pre-account funnel (`demo_started`, `demo_message_sent`,
`demo_completed`, `demo_converted`) is already covered by direct,
server-side `trackEvent()` calls from the unauthenticated demo routes,
which don't go through this endpoint at all — grepped every
`trackEvent()` call site in the codebase to confirm. Not a security bug
(the actual behavior is the safer of the two possible readings), but
worth fixing since a future reader — including whoever builds the
not-yet-started mobile client — could otherwise be misled into thinking
this endpoint is callable pre-login. Also checked the endpoint's
unconstrained `properties: z.record(...)` field for abuse potential;
covered adequately by the global 1MB request-body limit and the
standard authenticated rate limit, so no fix needed there.

## Pass 7 — Badges, curriculum, skill-trend, onboarding, dashboard

Date: 2026-11-03

Reviewed the remaining coaching/practice modules not yet covered by an
earlier pass: `badges.service.ts`/`.routes.ts`, `curriculum.service.ts`/
`.routes.ts`, `skillTrend.routes.ts`, `onboarding.routes.ts`,
`dashboard.routes.ts`.

**Badges, skill-trend, dashboard**: clean. Badge awarding correctly
handles the concurrent-award race via an explicit unique-violation check
(already fixed in this codebase's own history, re-verified independently
rather than trusted from the comment). Skill-trend goal-achievement-rate
and the dashboard aggregate are both correctly scoped by
`(user_id, workspace_id)`, and `getAggregateTeamProgress` (the one place
in the dashboard that shows cross-user data to non-member roles) returns
only an aggregate average and count — never individual rows — and
correctly excludes soft-deleted users. No bugs found.

**`curriculum.service.ts`'s `dismissCurriculum` — fixed**: re-verified
independently (not trusted from Pass 2's note) that this function's
`(id, user_id)` scoping is correct — a prior AI sub-review had
hallucinated a missing-scope finding here, and that's still not a real
gap. But the update itself was fire-and-forget with no check that any
row actually matched: passing a nonexistent or not-owned `curriculum_id`
silently "succeeded" with no signal anything was wrong, unlike every
other not-found/not-owned case in this module (`debrief.service.ts`,
`playbook.service.ts`), which all surface a 404. Not a security issue —
just fixed to match the established convention and give honest
client-side feedback.

**`onboarding.routes.ts`'s `GET /status` — real cross-workspace bug,
fixed**: `onboarding_completed_at` lives on the `users` table — one flag
per user, set once, ever — while the actual onboarding data
(`practice_profiles`: product description, target audience) is correctly
scoped per `(user_id, workspace_id)`, same as everything else in this
product. A user who completes onboarding in Workspace A and later joins
Workspace B via invite would see `onboarding_completed: true` in
Workspace B too, despite having no practice profile there — then get a
confusing 400 ("Complete Instant Setup...") from
`session.service.ts`'s `getPracticeProfile` the moment they tried to
start a session, having just been told they were done. Reproduced
directly against Postgres: the exact scenario (profile exists in
Workspace A only) confirmed the old logic reports `true` in both
workspaces, while deriving the answer from `practice_profiles`
existence for the CURRENT workspace instead correctly reports `true` in
A and `false` in B. Fixed by having `GET /onboarding/status` query
`practice_profiles` directly rather than reading the `users` flag,
making that table the single source of truth instead of a separately
tracked value that could drift from it. Flagged as worth fixing now
rather than documenting for later specifically because the mobile
onboarding flow hasn't been built yet — better to fix the contract
before a client is built against the wrong one than after.
`users.onboarding_completed_at` itself is left in place (harmless;
nothing else reads it).

## Pass 8 — Upload / AV-scan / persona-source extraction pipeline

Date: 2026-11-03

Reviewed `src/modules/files/` (`upload.routes.ts`, `upload.service.ts`,
`avScan.service.ts`, `extraction.service.ts`) and the three workers that
consume them (`avScanUpload.worker.ts`, `extractPersonaSource.worker.ts`,
`purgeOrphanedUploads.worker.ts`).

**Upload authorization, the AV-scan fail-safe design, and the orphan-purge
job**: all clean. `completeUpload`/`getUpload`/`deleteUpload` correctly
scope by `(id, workspace_id, user_id)` — re-verified independently, not
trusted from the existing comment. `scanBuffer` correctly fails closed
(rejects the file) if ClamAV itself is unreachable, rather than silently
skipping the scan. `purgeOrphanedUploadsHandler` only targets
`status: 'uploaded'`, so it was confirmed safe from the bug described
next — it never touches a `'processing'` row.

**Upload size cap — real deployment gap, documented**: `MAX_SIZE_BYTES`
(10MB) only validates the client-DECLARED `size_bytes` field at
signed-URL-issuance time; the actual upload bytes go straight from the
client to Supabase Storage via the signed URL and never pass back
through this backend, and the installed `@supabase/storage-js` version's
`createSignedUploadUrl()` has no size-limit parameter to pass through
here. A client that simply declares a small `size_bytes` bypasses the
cap entirely. The real enforcement point is the `dryrun-uploads` bucket's
own `file_size_limit` setting, which has to be configured when the
bucket is created — documented explicitly in both
`src/db/migrations/README.md`'s Storage bucket section and a code
comment at `MAX_SIZE_BYTES` itself, since this can't be fixed from
application code at all.

**`uploads.status` stuck at `'processing'` forever for persona-source
uploads — real bug, fixed**: `avScanUpload.worker.ts` sets
`status: 'processed'` once the AV scan passes for every upload purpose
EXCEPT `persona_source`, which it deliberately hands off to
`extractPersonaSource.worker.ts` instead. That worker, however, updates
`persona_sources.status` on both success and failure but never touched
the underlying `uploads` row at all — so `uploads.status` stayed at
`'processing'` indefinitely, even after extraction fully succeeded.
Harmless for data integrity (confirmed `purgeOrphanedUploadsHandler`
never touches it), but `GET /uploads/:id` — the endpoint a client polls
to show upload progress — would never report anything past
`"processing"`. Reproduced directly against Postgres (the exact
before/after state) before fixing. Now finalizes `uploads.status` to
`'processed'` or `'failed'` in both of `extractPersonaSourceHandler`'s
own success/failure branches, matching the convention the
non-persona-source path already follows. Flagged as worth fixing now,
same reasoning as the onboarding-status fix above: better to get the
upload-progress contract right before the mobile client is built
against it.

**SSRF via persona-source URLs — real, exploitable vulnerability, fixed**:
`extraction.service.ts`'s `extractTextFromUrl` has long had a header
comment describing "public-page fetch only" as a deliberate constraint,
but that was only ever a stated intent — `persona.schemas.ts`'s
`url: z.string().url()` validates well-formedness only, nothing about
scheme or destination. Any authenticated user could submit a
persona-source URL pointing at `169.254.169.254` (cloud instance
metadata — a standard path to credential theft on AWS/GCP/Azure),
`localhost`/an internal IP (this deployment's own Redis, or anything
else on its private network), and this backend would fetch it from its
own network position on their behalf. Not a hypothetical — grepped for
any existing host/IP filtering anywhere in the request path and found
none.

Fixed with a new `assertPublicUrl` guard: rejects non-http(s) schemes,
and for everything else resolves the hostname via DNS explicitly (using
`dns.lookup` with `all: true` to see every resolved address) and checks
every result against the private/reserved IPv4 and IPv6 ranges
(loopback, link-local/cloud-metadata, the three RFC1918 ranges, IPv6
unique-local and link-local) via Node's built-in `net.BlockList` —
checking the hostname alone would be DNS-rebinding-vulnerable, since a
domain can resolve differently at request time than at validation time,
or simply be an IP literal already. Also switched `extractTextFromUrl` to
follow redirects manually (`maxRedirects: 0` plus an explicit, bounded
5-hop loop) specifically so each redirect hop is re-validated through
the same guard before being followed — otherwise a redirect from an
initially-public URL to a private address would bypass the check
entirely, since axios's own built-in redirect-following happens after
validation already passed.

Verified directly (not just typechecked) against the real attack
scenarios: cloud-metadata IP literal, loopback (both bracketed-IPv6 and
plain), all three RFC1918 ranges, a hostname that resolves to loopback,
`file://`/`gopher://` schemes — all nine correctly blocked, each via the
intended code path with the intended error message (caught and fixed one
real implementation gap along the way: a bracketed IPv6 literal like
`[::1]` wasn't recognized by `net.isIP()` and fell through to the
DNS-lookup branch instead of the direct IP-literal check, ending up
blocked only incidentally). Also verified a genuine public IP literal
(`8.8.8.8`) correctly passes the guard and reaches the actual network
request, confirming the fix isn't over-broad.

## Pass 9 — Realtime channels

Date: 2026-11-03

Reviewed `src/realtime/channels.ts` (the server's entire realtime
surface — confirmed by grepping every file that references
`realtime`/`publishStatus`/`supabaseAdmin().channel`; the other matches
are just call sites and comments, not additional logic). Clean — a prior
genuine channel-leak fix (`unsubscribe()` in `finally`) is already
correctly in place, and every `publishStatus` call site only ever
broadcasts an entity's own ID or a short hardcoded status string, never
user-controlled free text, AI-generated content, or sensitive fields
(persona details, session content, scores). The broadcast channel is
purely a "something changed, go refetch via the authenticated REST API"
signal, never the data source itself — no leak risk. Channel-subscription
authorization itself lives in the RLS policy content
(`0011_realtime_broadcast_authorization.sql`), out of scope for this
pass per instruction. No bugs found.

## Pass 10 — Export/GDPR flows

Date: 2026-11-04

Reviewed `src/modules/auth/export.routes.ts`,
`src/jobs/workers/exportUserData.worker.ts`, and
`src/jobs/workers/purgeSoftDeletedAccounts.worker.ts` — the full
account-export and hard-deletion surface.

`export.routes.ts`: clean. Correctly scoped to the requesting user,
rate-limited to 3/hour via `exportRateLimit`. No idempotency key on the
job enqueue, but judged acceptable given the loose rate limit (worst
case: a couple of redundant export emails, not a correctness/security
issue).

**Bug found and fixed — GDPR export completeness.** The export payload
previously included only `users` (4 fields), `practice_sessions` (full
row), `personas` (full row), and `playbooks` (full row), each via a
top-level `.select('*')`. On Supabase/PostgREST, `.select('*')` never
auto-joins related tables, so every child table holding the *actual
content* of a session, persona, or playbook was silently omitted:
`session_messages` (the literal sales-call transcript), `session_debriefs`
(AI feedback), `session_skill_scores`, `session_goals`,
`session_context_summaries`, `session_state_snapshots`,
`session_message_attachments`, `session_retries` (all keyed by
`session_id` → `practice_sessions.user_id`); `persona_sources` (keyed by
`persona_id` → `personas.created_by_user_id`), including any extracted
text flagged for PII; `playbook_versions` (keyed by `playbook_id` →
`playbooks.created_by_user_id`) — i.e. the actual script content
(opening message, discovery questions, objection responses), not just
the playbook's title row. Also missing entirely: `practice_profiles`,
`curriculum_plans`, `badges`, `user_skill_trend`,
`notification_preferences`, `push_tokens`, `uploads` — all directly
`user_id`-scoped tables with no join needed.

Verified the gap directly against Postgres: inserted a
`practice_sessions` row and a `session_messages` row referencing it,
confirmed the old query shape (`practice_sessions.select('*')` alone)
never returns the message row, then confirmed the new
`session_id IN (...)` fan-out query correctly retrieves it. Fixed by
fetching session/persona/playbook IDs first, then fanning out to every
owned child table in parallel, with an empty-array guard on each `.in()`
call (skip the query rather than sending `.in(col, [])`).

Deliberately still excluded from the export: workspace-scoped tables
(`subscriptions`, `payment_transactions`, `workspace_members`,
`workspace_invites`) since they involve other workspace members' data
and this single-user-keyed job has no workspace-level access control to
safely scope a "my billing history" export; and internal/system tables
(`plans`, `system_config`, `webhook_events`, `webhook_signature_failures`,
`audit_log`, `analytics_events`, `ai_usage_log`,
`ai_scoring_evaluations`, `demo_sessions`,
`email_verification_tokens`/`password_reset_tokens` — security
artifacts, not personal data a user needs returned to them).

**Bug found and fixed — hard account purge throws on almost every real
user.** `purgeSoftDeletedAccountsHandler`'s hard-delete step is commented
"Cascades handle practice_sessions, personas, practice_profiles, etc. per
the FK cascade rules" — but `personas.created_by_user_id`,
`playbooks.created_by_user_id`, and `uploads.user_id` were defined with
no `ON DELETE` action at all (`0003_practice_domain.sql`), defaulting to
`NO ACTION`. Reproduced directly against Postgres: deleting a `users` row
that owns a persona raises `ERROR: update or delete on table "users"
violates foreign key constraint "personas_created_by_user_id_fkey"`
rather than cascading or nulling anything. Since creating a persona is
core product usage, this isn't an edge case — the purge job would throw
for nearly every deletion-requesting user, get caught by the worker's
outer `catch`, log an ALERT, and re-throw, so the whole batch fails and
keeps re-alerting via BullMQ retries instead of ever completing a clean
deletion.

Fixed with `0017_fk_actions_for_account_purge.sql`, matching each
table's actual semantics rather than applying one blanket rule:
`personas`/`playbooks` get `ON DELETE SET NULL` (both are deliberately
workspace-shared, reusable assets — `personas.reusable`, both scoped by
`workspace_id` not just creator — meant to keep working for the rest of
the workspace after their creator leaves, per `upload.service.ts`'s own
comment distinguishing shared assets from individual uploads); `uploads`
gets `ON DELETE CASCADE` instead, since `uploads.user_id` is a `NOT NULL`
strict access-control scope used throughout `upload.service.ts` (every
read/complete/delete requires it to match the requesting user), not a
shared asset — an upload with no owning user has no legitimate reason to
survive, matching its sibling `workspace_id` FK's existing cascade.
Verified both halves directly against Postgres: after the migration, the
same `DELETE FROM users` that previously threw now succeeds, with the
owned persona surviving (`created_by_user_id` nulled) and the owned
upload row gone (cascaded away). Also corrected the worker's own comment,
which had asserted personas cascade when they in fact (now, correctly)
get nulled, not deleted.

Not yet reviewed in this pass: `checkRenewalsDue`/the rest of the
scheduler and job-worker list — deferred to the next pass (job workers
and scheduler), since this pass's scope was specifically the
export/deletion pair.

## Pass 11 — Scheduler and remaining job workers

Date: 2026-11-04

Reviewed `src/jobs/scheduler.ts`, `src/jobs/index.ts`, `src/jobs/queues.ts`,
`src/jobs/deadLetterPagination.ts`, and every remaining worker not already
covered by an earlier pass: `archiveOldSnapshots`, `attemptRenewalCharge`,
`avScanUpload`, `generateDebrief`, `processWebhookEvent`,
`purgeExpiredDemoSessions`, `recomputeCurriculum`, `recomputeSkillTrend`,
`sampleAiScoringEvaluations`, `scoreSessionSkills`,
`scoringConsistencyCheck`, `sendPaymentFailedEmail`, `sendWeeklySummary`,
`summarizeConversation`, `synthesizePersona`.

`scheduler.ts`/`index.ts`: clean, and extensively already fixed by prior
work (documented findings C5, CRIT-1, HIGH-7, plus the migration off
BullMQ's deprecated repeatable-jobs API to `upsertJobScheduler`). Every
`SCHEDULES` entry has a matching `HANDLERS` entry; nothing registered
with no handler or vice versa.

**Bug found and fixed — unvalidated queue name in admin job-retry
endpoint.** `queues.ts`'s `retryJob(queueName, jobId)` took
`req.body.queue` validated only as `z.string()`, cast straight to
`QueueName` with no membership check, then passed to `getQueue()`.
Verified directly: `new Queue('totally-not-a-real-queue-name', ...)`
constructs successfully with BullMQ — the constructor does no validation
of its own — so an admin typo (or probing) silently created and cached
an unbounded bogus `Queue` instance in the process-lifetime `_queues`
Map, surfaced only as a confusing "Job not found" error rather than a
clear "unknown queue" one. Fixed by validating against the real
`QueueName` set before calling `getQueue`, and switched both of
`retryJob`'s error paths from a plain `Error` (masked into a generic 500
by `errorHandler.ts`) to `ApiError`, matching the rest of the codebase's
convention.

**Bug found and fixed — dead-letter pagination silently drops
same-millisecond ties.** `deadLetterPagination.ts`'s watermark was a bare
failedAt millisecond compared with strict less-than. When more failed
jobs in one queue share the exact same millisecond than fit on a page,
the window-widening loop in `fetchQueueOlderThan` stops the instant it
collects `limit` qualifying jobs, even if more jobs at that identical
boundary timestamp exist further from the tail; the next page's
watermark then becomes that same timestamp, so the stranded jobs (also
at that ms) never satisfy the strict `<` filter — `next_cursor` comes
back `null` while real dead-letter jobs remain permanently unreachable.
Reproduced directly with a fake BullMQ-shaped queue: 5 jobs at one
millisecond + 3 at a later one, `limit=3` — 2 of 8 jobs vanished from the
feed entirely across pagination, with pagination falsely reporting
completion. Fixed by tracking which specific job IDs at the boundary
millisecond have already been emitted (`excludeIds`) and using
exact-set-exclusion as the tie-break, mirroring the `(createdAt, id)`
compound-keyset pattern `lib/cursorPagination.ts` already uses for
Postgres-backed cursors (adapted to a set, since same-millisecond ties
can be more than one job, unlike a DB primary key). Verified against
three scenarios — partial ties, an all-same-millisecond worst case, and
the original concurrent-insert guarantee the file's own header comment
claims — all three now walk every job exactly once with no skips or
duplicates.

**Bug found and fixed — unbounded `curriculum_plans` row growth.**
`recomputeCurriculum` (triggered after every completed session) always
inserted a new row with no supersession of the user's prior plan, and
nothing anywhere (no scheduled job, no `expires_at` check) ever
transitioned an old row's `status` away from `'active'`. Reproduced
directly against Postgres: 5 recomputes for one user produced 5
permanently active rows. Harmless today only incidentally — both real
read sites (`getCurrentCurriculum`, `sendWeeklySummary.worker.ts`) happen
to order by `created_at DESC .limit(1)` — but unbounded growth and a
landmine for any future query (a mobile client's curriculum-history view,
say) that reasonably assumes `status: 'active'` means currently active.
Fixed by explicitly marking any prior active plan `'superseded'` before
inserting the new one; verified against Postgres to produce exactly one
active row per user+workspace after repeated recomputes.

**Bug found and fixed — unescaped HTML in every transactional email
template, the most severe finding of this pass.** No HTML-escaping
existed anywhere in the email-building layer
(`notifications/email.service.ts`). `buildWorkspaceInviteEmailHtml`
interpolated `workspaceName` and `inviterName` — both directly
user-controlled (`display_name` up to 120 chars, workspace `name` up to
200 chars, length-bounded but never escaped) — straight into the email
body. Verified with a real exploit payload: setting a display name to an
`<a href="https://phishing.example/login">Click here to verify your
DryRun account</a>` tag and sending a workspace invite produces exactly
that clickable phishing link, styled as ordinary invite text, in a real
transactional email sent from DryRun's own address — reachable by any
authenticated user against anyone they invite, no special privilege
needed; an `<img onerror=...>` payload in a workspace name was verified
the same way. The same gap existed in `sendWeeklySummary.worker.ts`'s
`buildWeeklySummaryEmailHtml` for AI-generated debrief/curriculum text
(`bestCoachableMoment` is raw AI output — `outputValidator.ts` only
constrains it to `z.string().min(1)`, no escaping) and badge
label/description (hardcoded today, but no reason to leave unescaped).
Fixed by adding a shared `escapeHtml()` helper and applying it to every
interpolated value across both files that isn't one of our own
app-controlled URLs; verified the fix blocks the same exploit payloads
(now rendered as inert escaped text) while leaving legitimate names with
apostrophes/unicode readable.

Everything else reviewed clean, with no changes needed:
`archiveOldSnapshots` (bounded batches, correctly waits for aggregates
before pruning raw detail); `attemptRenewalCharge` (dunning schedule,
distributed lock, and the CRIT-1/CRIT-3/HIGH-10/MED-4/MED-5 fixes already
in place and verified sound — `chargeRenewal` always resolves to
`{success: false}` on any provider/network error rather than throwing, so
the dunning path is never silently skipped); `avScanUpload` (consistent
with the `extractPersonaSource`/upload-status fix from an earlier pass);
`generateDebrief` and its `debrief.service.ts` backing (already
cross-tenant-scoped); `processWebhookEvent` (the documented cross-tenant
billing-misattribution fix is sound; leaving `pending_tx_ref` set on a
failed verification is deliberate, matching `confirmCheckout`'s own
retry-friendly pattern); `purgeExpiredDemoSessions` (simple, idempotent);
`recomputeSkillTrend` (append-only by design — `user_skill_trend` is a
time-series table, confirmed by its non-unique `(user_id, workspace_id,
period_start DESC)` index and both real read sites ordering/limiting as
a series, not a single current row); `sampleAiScoringEvaluations`
(correct; the `Math.random()`-based shuffle is statistically biased but
inconsequential for human spot-review sampling); `scoreSessionSkills`;
`scoringConsistencyCheck`/`scoringConsistency.ts` (a cheap rule-based
drift signal, deliberately not a second AI call, per the architecture
doc); `sendPaymentFailedEmail` (a retried duplicate send is a mild
annoyance, not an idempotency-critical issue, unlike a charge);
`summarizeConversation` (prompt-injection-aware framing, documented
race-condition fix already in place); `synthesizePersona` (the
documented cross-member-profile-mixing and optimistic-concurrency fixes
are both sound).

## Not yet covered (proposed as later milestones, not done in this pass)

- A real test suite (vitest) for the AI output-validation pipeline and
  billing-reconciliation RPC — both now reviewed and, where real bugs
  were found, fixed and mechanically verified, but neither has
  regression tests yet to keep them that way. Proposed as the next
  milestone.
- RLS policy content in `0007_rls_policies.sql` — flagged by the repo's
  own migrations README as needing an adversarial test suite before
  launch; not written in this pass.
- Expo mobile-app-specific backend gaps (push notification payload
  shape, deep-link / auth-redirect handling, any mobile-specific CORS or
  session requirements) — needs a read of the actual mobile client repo
  or its contract expectations, which weren't provided.
