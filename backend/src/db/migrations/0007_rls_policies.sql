-- 0007_rls_policies.sql
--
-- RLS is the ACTUAL enforcement boundary for workspace isolation and for
-- the privacy-by-design rule that no admin/owner role can read another
-- member's raw session transcript (architecture doc 7.2 / 19.10). The
-- application layer (this backend, using the service-role key) bypasses
-- RLS by design and re-implements its own scoping in every query -- these
-- policies are the last-line defense if that application-layer scoping
-- ever has a bug, and they are what an adversarial RLS test suite (run in
-- CI, per the architecture doc) should be written against.
--
-- NOTE: this backend's own queries use the Supabase service-role key,
-- which bypasses RLS entirely. These policies matter for (a) defense in
-- depth against an application bug, and (b) any future direct-from-client
-- Supabase access (e.g., a mobile client reading Realtime broadcast
-- payloads) that might authenticate with the user's own JWT instead of
-- going through this API.

alter table practice_sessions enable row level security;
alter table session_messages enable row level security;
alter table session_state_snapshots enable row level security;
alter table session_debriefs enable row level security;
alter table ai_scoring_evaluations enable row level security;
alter table personas enable row level security;
alter table playbooks enable row level security;
alter table workspace_members enable row level security;

-- practice_sessions: visible only to the owning user, never to other
-- workspace members regardless of role -- this is the structural privacy
-- guarantee, not a convention.
create policy practice_sessions_owner_only on practice_sessions
  for select using (user_id = auth.uid());

create policy practice_sessions_owner_write on practice_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- session_messages / session_state_snapshots / session_debriefs /
-- ai_scoring_evaluations: visible only via ownership of the parent session.
create policy session_messages_owner_only on session_messages
  for select using (
    exists (select 1 from practice_sessions s where s.id = session_messages.session_id and s.user_id = auth.uid())
  );

create policy session_state_snapshots_owner_only on session_state_snapshots
  for select using (
    exists (select 1 from practice_sessions s where s.id = session_state_snapshots.session_id and s.user_id = auth.uid())
  );

create policy session_debriefs_owner_only on session_debriefs
  for select using (
    exists (select 1 from practice_sessions s where s.id = session_debriefs.session_id and s.user_id = auth.uid())
  );

create policy ai_scoring_evaluations_owner_only on ai_scoring_evaluations
  for select using (
    exists (select 1 from practice_sessions s where s.id = ai_scoring_evaluations.session_id and s.user_id = auth.uid())
  );

-- personas / playbooks: workspace-scoped (any active member of the
-- workspace can see these -- unlike raw transcripts, personas and
-- playbooks are meant to be shared/reusable within a team).
create policy personas_workspace_members on personas
  for select using (
    exists (
      select 1 from workspace_members m
      where m.workspace_id = personas.workspace_id and m.user_id = auth.uid() and m.status = 'active'
    )
  );

create policy playbooks_workspace_members on playbooks
  for select using (
    exists (
      select 1 from workspace_members m
      where m.workspace_id = playbooks.workspace_id and m.user_id = auth.uid() and m.status = 'active'
    )
  );

-- workspace_members: a user can see membership rows only for workspaces
-- they themselves belong to.
create policy workspace_members_self_workspace on workspace_members
  for select using (
    exists (
      select 1 from workspace_members m2
      where m2.workspace_id = workspace_members.workspace_id and m2.user_id = auth.uid() and m2.status = 'active'
    )
  );

-- ============================================================
-- ADVERSARIAL TEST SUITE REQUIREMENT (architecture doc 7.3 / 19.10):
-- Before launch, and on every change to this file or to the schema, run
-- an automated suite that attempts, as each role in each workspace:
--   - reading another workspace's practice_sessions / session_messages
--   - reading another MEMBER's practice_sessions within the SAME workspace
--     (this must fail even for an owner/admin role)
--   - writing to another user's practice_sessions
-- and asserts every one of these attempts is rejected. This is CI-gated,
-- not a manual one-time review, precisely because a newly added table
-- without its own policy is the most common way this silently regresses.
-- ============================================================
