-- Migration 0002: atomic session-message sequence allocation
--
-- Backs the fix for FINAL_BACKEND_AUDIT.md finding H1: session.service.ts's
-- nextSequenceIndex() (and a second, independently-duplicated inline copy
-- in session.routes.ts's POST /:id/attachments handler) derived the next
-- sequence_index by COUNTing existing session_messages rows for a session —
-- a classic TOCTOU race. Two concurrent requests for the same session (a
-- realistic trigger on a mobile app: a client retry after a slow/dropped
-- response, or a double-tap before the send button disables) could both
-- read the same count before either inserted, both compute the same
-- sequence_index, and the second INSERT would fail outright on
-- session_messages' existing unique(session_id, sequence_index)
-- constraint — surfacing to the user as a generic 500 on the single
-- hottest write path in the product.
--
-- Fixed with a dedicated counter column plus a single atomic
-- UPDATE ... RETURNING, wrapped in a small SQL function so the
-- read-modify-write happens as one indivisible statement at the database
-- level regardless of how many API instances call it concurrently — the
-- same class of fix already correctly applied elsewhere in this codebase
-- via Lua-scripted Redis primitives (config/redis.ts's
-- checkAndReserveBudget/claimIdempotencyKey), just implemented in Postgres
-- here since session_messages' ordering is itself a Postgres-level
-- invariant (the unique constraint), not a Redis-tracked one.
--
-- BACKFILL: existing sessions get next_sequence_index initialized to one
-- past their current highest sequence_index, so the counter picks up
-- exactly where COUNT-based allocation left off — no gap, no collision
-- with already-inserted rows.

alter table practice_sessions
  add column next_sequence_index integer not null default 0;

update practice_sessions ps
set next_sequence_index = coalesce(
  (select max(sm.sequence_index) + 1 from session_messages sm where sm.session_id = ps.id),
  0
);

-- Atomically increments a session's next_sequence_index and returns the
-- value that was allocated to THIS caller (i.e. the value before the
-- increment) — mirrors the old nextSequenceIndex()'s contract ("give me
-- the sequence_index this new message should use") exactly, so callers
-- need no logic change beyond how they invoke it.
create or replace function allocate_session_sequence_index(p_session_id uuid)
returns integer
language sql
as $$
  update practice_sessions
  set next_sequence_index = next_sequence_index + 1
  where id = p_session_id
  returning next_sequence_index - 1;
$$;
