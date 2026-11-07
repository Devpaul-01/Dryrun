# Database Migrations

Run these against your Supabase Postgres instance in order — they are
numbered and must be applied sequentially (0001 → 0017). Each file is
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
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0012_subscriptions_pending_tx_ref.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0013_payment_transactions_columns_and_reconciliation.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0014_one_active_subscription_per_workspace.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0015_drop_workspace_plan_id.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0016_drop_workspace_seats_purchased.sql
psql "$SUPABASE_DB_CONNECTION_STRING" -f 0017_fk_actions_for_account_purge.sql
```

FIX (backend-takeover audit): this list previously still named 0012 as
`payment_transactions_columns_and_reconciliation.sql` and 0013 as
`one_active_subscription_per_workspace.sql` — stale filenames left over
from before the `pending_tx_ref` migration was inserted ahead of them
(see that migration's own header comment for why), which shifted every
migration from 0012 onward up by one. 0016 and 0017 were missing from
this list entirely. Corrected to match the files actually on disk.

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
  channel-publishing convention in `src/realtime/channels.ts`. Not
  applicable to a plain (non-Supabase) Postgres instance — the
  `test/billing/` suite's harness (`test/helpers/testDb.ts`) deliberately
  skips this one file for that reason; see its own header comment.
- `0012` adds `subscriptions.pending_tx_ref` and its partial unique
  index — depends on `subscriptions` from `0005`. Must apply before
  `0013`, which defines a function referencing this column; originally
  missing entirely (found by the backend-takeover audit, AUDIT.md Pass
  1/3 — see this migration's own header comment).
- `0013` adds `payment_transactions.card_token` / `.provider_tx_id`, an
  index, and the `reconcile_successful_payment()` RPC — depends on
  `payment_transactions` and `subscriptions` from `0005`, and on
  `subscriptions.pending_tx_ref` from `0012`. Regression-covered by
  `test/billing/reconcileSuccessfulPayment.test.ts`.
- `0014` adds a unique index guaranteeing at most one active subscription
  per workspace — depends on `subscriptions` from `0005`; will fail to
  apply if your data already violates the invariant (see the migration's
  own comments for the cleanup query to run first).
- `0015` drops `workspaces.plan_id` — depends on `workspaces` from `0002`
  and expects no application code still reads that column (none does,
  as of this migration).
- `0016` drops `workspaces.seats_purchased` — same dependency as `0015`;
  expects the seat-purchase feature already removed from application
  code (it was, in the same patch that introduced this migration).
- `0017` corrects the `on delete` actions on `personas.created_by_user_id`,
  `playbooks.created_by_user_id`, and `uploads.user_id` (`set null` for
  the first two, `cascade` for the third) so hard-deleting a `users` row
  no longer fails with a foreign-key violation — depends on those three
  tables from `0003`. Found by the backend-takeover audit (AUDIT.md
  Pass 10) while reviewing `purgeSoftDeletedAccounts.worker.ts`'s
  hard-delete step against a real database.

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

**Set the bucket's own `file_size_limit` to 10MB (or lower) when you
create it — do not rely on application code alone to enforce this.**
Found during the backend-takeover mobile-readiness review:
`upload.service.ts`'s `MAX_SIZE_BYTES` check only validates the
CLIENT-DECLARED `size_bytes` field at signed-URL-issuance time, before
any bytes are uploaded. The actual upload — `uploadToSignedUrl()` or an
equivalent direct PUT to the signed URL — happens straight from the
client to Supabase Storage and never passes back through this backend,
so nothing in this codebase can enforce the real byte count. The
installed `@supabase/storage-js` version's `createSignedUploadUrl()`
doesn't take a size-limit parameter either (only `{ upsert }`) — the
bucket-level setting is the only real enforcement point. Without it, a
client that simply declares a small `size_bytes` value bypasses the 10MB
cap entirely and can upload an arbitrarily large file.
