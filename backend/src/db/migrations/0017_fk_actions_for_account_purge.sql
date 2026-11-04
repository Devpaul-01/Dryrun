-- =============================================================================
-- 0017: fix missing ON DELETE actions blocking hard account purge
-- =============================================================================
-- Finding (backend-takeover audit, Task #14 — reviewing
-- purgeSoftDeletedAccounts.worker.ts): that worker's hard-delete step
-- (`DELETE FROM users WHERE id = ...`) is documented with the comment
-- "Cascades handle practice_sessions, personas, practice_profiles, etc.
-- per the FK cascade rules" — but personas.created_by_user_id,
-- playbooks.created_by_user_id, and uploads.user_id were defined with no
-- ON DELETE action at all (0003_practice_domain.sql), which defaults to
-- NO ACTION. Reproduced directly against Postgres: deleting a users row
-- that has an owned persona raises
--   ERROR: update or delete on table "users" violates foreign key
--   constraint "personas_created_by_user_id_fkey"
-- rather than cascading or nulling anything. Since creating a persona is
-- core product usage, this is the common case, not an edge case — the
-- compliance-relevant purge job would throw on essentially every
-- deletion-requesting user who ever used the product, get caught by the
-- worker's outer catch, log an ALERT, and re-throw, so the whole batch
-- (via BullMQ's retry) fails and keeps re-alerting indefinitely instead
-- of completing a single clean deletion.
--
-- Fix differs by table, matching each one's actual semantics:
--   - personas / playbooks: `created_by_user_id` is already nullable, and
--     both are deliberately workspace-shared, reusable assets
--     (personas.reusable; both scoped by workspace_id, not just by
--     creator) — per upload.service.ts's own access-control comment,
--     unlike an upload a persona is meant to outlive its creator and
--     stay usable by the rest of the workspace. SET NULL preserves the
--     shared asset and only clears attribution, which is the correct
--     "who made this" semantics once that user no longer exists.
--   - uploads: `user_id` is NOT NULL and is used as a strict
--     access-control scope (upload.service.ts requires it to match the
--     requesting user for every read/complete/delete) — not a shared
--     asset. An upload with no owning user has no legitimate reason to
--     survive, so CASCADE (matching workspace_id's own existing
--     `on delete cascade`) rather than nulling a NOT NULL column that
--     exists specifically to gate access.
-- =============================================================================

alter table personas
  drop constraint personas_created_by_user_id_fkey,
  add constraint personas_created_by_user_id_fkey
    foreign key (created_by_user_id) references users(id) on delete set null;

alter table playbooks
  drop constraint playbooks_created_by_user_id_fkey,
  add constraint playbooks_created_by_user_id_fkey
    foreign key (created_by_user_id) references users(id) on delete set null;

alter table uploads
  drop constraint uploads_user_id_fkey,
  add constraint uploads_user_id_fkey
    foreign key (user_id) references users(id) on delete cascade;
