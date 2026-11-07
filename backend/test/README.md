# Tests

Run with `npm test` (or `npm run test:watch` while iterating).

## What's covered

- `test/ai/` — the AI output-validation pipeline (AUDIT.md Pass 4):
  `outputValidator.test.ts` exercises every Zod schema in
  `src/modules/ai/outputValidator.ts` directly (bounds, required fields,
  code-fence stripping); `aiService.retry.test.ts` exercises the
  reject→retry→fallback control flow in `src/modules/ai/ai.service.ts`
  with `callWithFallback` and `supabaseAdmin` mocked — no network or
  database calls, runs instantly.
- `test/billing/` — the billing-reconciliation RPC (AUDIT.md Pass 1/3):
  `reconcileSuccessfulPayment.test.ts` runs against a **real Postgres
  database**, freshly created and migrated from empty for each test run.
  This is deliberate — the two real bugs this suite guards against
  (a missing column, a uuid/text cast mismatch) were schema/SQL-level
  failures a mocked database layer cannot catch. See that file's header
  comment and `test/helpers/testDb.ts` for the full rationale.

## Running the billing suite locally

It needs a Postgres server reachable with a role that can create and drop
databases. Point `TEST_DATABASE_URL` at it (an *admin* connection string —
the suite creates/drops its own database on this server, named by
`TEST_DB_NAME`, default `dryrun_vitest`):

```bash
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres" npm test
```

If `TEST_DATABASE_URL` is unset, it defaults to that same local
connection string — convenient for a dev container with a local Postgres
already running, but something CI must set explicitly (see
`.github/workflows/`).

The AI suite needs no database or environment variables at all.
