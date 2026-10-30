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

## Not yet covered (proposed as later milestones, not done in this pass)

- Route-by-route authz/ownership review (middleware chain looks
  consistent at a glance: `requestId → securityHeaders → authenticate →
  resolveWorkspace → rateLimit → validate`, but not independently
  verified per-route).
- The AI output-validation pipeline and billing-reconciliation RPC the
  README highlights as the two highest-value places for tests — not
  independently re-verified here.
- RLS policy content in `0007_rls_policies.sql` — flagged by the repo's
  own migrations README as needing an adversarial test suite before
  launch; not written in this pass.
- Expo mobile-app-specific backend gaps (push notification payload
  shape, deep-link / auth-redirect handling, any mobile-specific CORS or
  session requirements) — needs a read of the actual mobile client repo
  or its contract expectations, which weren't provided.
