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

## Not yet covered (proposed as later milestones, not done in this pass)

- The AI output-validation pipeline — the README's other highest-value
  place for tests, alongside the billing-reconciliation RPC now covered
  above — not independently re-verified here.
- RLS policy content in `0007_rls_policies.sql` — flagged by the repo's
  own migrations README as needing an adversarial test suite before
  launch; not written in this pass.
- Expo mobile-app-specific backend gaps (push notification payload
  shape, deep-link / auth-redirect handling, any mobile-specific CORS or
  session requirements) — needs a read of the actual mobile client repo
  or its contract expectations, which weren't provided.
