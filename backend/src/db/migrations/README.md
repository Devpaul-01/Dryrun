# Database Migrations

Run these against your Supabase Postgres instance in order — they are
numbered and must be applied sequentially (0001 → 0007). Each file is
idempotent-unsafe by nature of `create table`/`create type` (re-running a
file that already applied will error on the duplicate object), which is
intentional: migrations should be tracked as applied-once, not re-run.

**Recommended application method:** the Supabase CLI's migration workflow
(`supabase db push` against a linked project, or `psql` directly against
your connection string for a manual first pass):

```bash
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0001_extensions_and_helpers.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0002_identity_workspace.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0003_practice_domain.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0004_ai_integrity.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0005_billing_domain.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0006_notifications_analytics.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0007_rls_policies.sql
```

## Order dependencies

- `0002` creates `workspaces` before `users` (a workspace's `owner_user_id`
  FK is added via `alter table` after `users` exists in the same file, to
  break the circular reference cleanly).
- `0003` depends on `users` and `workspaces` from `0002`.
- `0004` depends on `practice_sessions`/`session_messages` from `0003`.
- `0005` depends on `workspaces` (adds the `plan_id` FK via `alter table`
  once `plans` exists) and on `users` (for `audit_log`/`system_config`).
- `0006` depends on `users`, `workspaces`, `practice_sessions`.
- `0007` (RLS) depends on every table it protects already existing.

## Before production launch (mandatory, not optional)

Per the architecture doc's security section: write and run an **adversarial
RLS test suite** against these policies — attempt cross-workspace and
cross-member reads/writes as each role and assert every attempt fails. Wire
this into CI so a future schema change that adds a table without a matching
policy is caught automatically, not discovered in production. See the
comment block at the bottom of `0007_rls_policies.sql` for the specific
scenarios to cover.

## Supabase Storage bucket

These migrations create tables only. You also need to create the
`dryrun-uploads` Storage bucket (referenced in
`src/modules/files/upload.service.ts`) via the Supabase dashboard or CLI,
with public access disabled — all access goes through signed URLs issued
by this backend.
