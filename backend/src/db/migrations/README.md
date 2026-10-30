# Database Migrations

Run these against your Supabase Postgres instance in order — they are
numbered and must be applied sequentially (0001 → 0015). Each file is
idempotent-unsafe by nature of `create table`/`create type` (re-running a
file that already applied will error on the duplicate object), which is
intentional: migrations should be tracked as applied-once, not re-run.

This is the single canonical migration sequence. Earlier revisions of
this repo had the 0008+ patches below split across two other directories
(`backend/db/migrations/` and a top-level `db/migrations/`), each
restarting its own counter at 0001/0004 — that was a real hazard (two
different `0001`s, two different `0004`s, no single apply order anyone
could follow correctly) and has been consolidated into this one
directory and sequence. If you have an existing database provisioned
from before this consolidation, diff what you've actually applied
against the list below by content, not by the old file numbering.

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
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0008_persona_sources_scenario_type.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0009_atomic_session_sequence.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0010_persona_generation_status.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0011_realtime_broadcast_authorization.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0012_payment_transactions_columns_and_reconciliation.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0013_one_active_subscription_per_workspace.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0014_drop_workspace_plan_id.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0015_drop_workspace_seats_purchased.sql
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
- `0008` adds `persona_sources.scenario_type` — depends on `persona_sources`
  from `0003`.
- `0009` adds an atomic `allocate_session_sequence_index()` RPC and an
  `alter table practice_sessions` — depends on `practice_sessions` /
  `session_messages` from `0003`.
- `0010` adds the `persona_generation_status` enum and a column on
  `personas` — depends on `personas` from `0003`.
- `0011` enables RLS on `realtime.messages` for broadcast authorization —
  depends on Supabase's built-in `realtime` schema existing (it always
  does on a Supabase project) and conceptually on the `session`/`persona`
  channel-publishing convention in `src/realtime/channels.ts`.
- `0012` adds `payment_transactions.card_token` / `.provider_tx_id`, an
  index, and the `reconcile_successful_payment()` RPC — depends on
  `payment_transactions` and `subscriptions` from `0005`.
- `0013` adds a unique index guaranteeing at most one active subscription
  per workspace — depends on `subscriptions` from `0005`; will fail to
  apply if your data already violates the invariant (see the migration's
  own comments for the cleanup query to run first).
- `0014` drops `workspaces.plan_id` — depends on `workspaces` from `0002`
  and expects no application code still reads that column (none does,
  as of this migration).
- `0015` drops `workspaces.seats_purchased` — same dependency as `0014`;
  expects the seat-purchase feature already removed from application
  code (it was, in the same patch that introduced this migration).

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
