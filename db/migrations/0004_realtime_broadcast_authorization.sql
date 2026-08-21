-- Migration 0004: realtime broadcast authorization
--
-- Backs BACKEND_API_RECOMMENDATIONS.md finding B2: realtime/channels.ts's
-- publishStatus() broadcasts on session:{sessionId} and persona:{personaId}
-- channel names that are guessable from any UUID a client already has.
-- Nothing server-side previously restricted who could .subscribe() to a
-- channel by name alone — any authenticated (or, depending on project
-- settings, even unauthenticated) client able to guess/enumerate a UUID
-- could subscribe to another user's session-completion or
-- persona-generation events. The payloads are minimal today (just the ID,
-- no content), so this is a metadata/existence leak rather than a data
-- leak, but it's a real gap that gets worse the moment a future change
-- puts real content into these broadcasts.
--
-- MECHANISM: Supabase Realtime Authorization for Broadcast. As of the
-- version this policy targets, Supabase evaluates RLS policies against
-- realtime.messages for each subscribe attempt on a PRIVATE channel — a
-- channel a client explicitly opts into as private on the client SDK side
-- (`supabase.channel(name, { config: { private: true } })`). This policy
-- alone does not retroactively secure a channel the client subscribes to
-- as public; the frontend's realtime subscription code must request a
-- PRIVATE channel for session:{sessionId} / persona:{personaId} for this
-- policy to actually be consulted at all.
--
-- ============================================================================
-- ACTION REQUIRED ON YOUR END — THIS MIGRATION ALONE DOES NOT FULLY CLOSE
-- THE GAP (verified against Supabase's current Realtime Authorization docs
-- as of this fix — this is a fast-moving platform feature, worth
-- re-checking supabase.com/docs/guides/realtime/authorization directly if
-- any of the below has since changed):
--   1. In your Supabase dashboard, under Project Settings > Realtime, you
--      must explicitly DISABLE "Allow public access." Realtime
--      Authorization is opt-out, not opt-in by default — if "Allow public
--      access" stays enabled, clients can still subscribe to these
--      channels as PUBLIC (bypassing this policy entirely) even after
--      this migration exists and even if the frontend requests a private
--      channel for some subscriptions and not others.
--   2. The frontend must subscribe with `{ config: { private: true } }`
--      (e.g. `supabase.channel('session:<id>', { config: { private: true
--      } })`) for THIS policy to be consulted at all — a public-channel
--      subscription to the same topic name is treated as a completely
--      separate channel from the private one and is unaffected by this
--      policy.
--   3. Before subscribing, the frontend must call
--      `supabase.realtime.setAuth(accessToken)` with the user's current
--      Supabase access token. Without this, Realtime has no JWT to
--      resolve auth.uid() against inside this policy — the subscription
--      will fail even with steps 1 and 2 done correctly. This is easy to
--      miss because nothing about it is implied by the channel-name
--      convention or the `private: true` flag alone.
--   4. If this is misconfigured, the visible symptom on the client is a
--      subscribe callback firing with status `CHANNEL_ERROR` and an error
--      message like "You do not have permissions to read from this
--      Topic" — worth knowing what to search for if this doesn't work on
--      the first try.
--   5. The channel-naming convention (session:{sessionId}, persona:
--      {personaId}) is unchanged by this migration; only who can
--      subscribe to a name they already know is now gated.
-- ============================================================================
--
-- POLICY LOGIC: realtime.messages rows carry a `topic` column equal to the
-- channel name a client is trying to subscribe to (e.g. "session:<uuid>").
-- The policy below extracts the UUID after the ':' and checks it against
-- practice_sessions/personas ownership for the currently-authenticated
-- user (auth.uid(), Supabase's standard RLS-context function for the
-- calling user under the anon/authenticated key — NOT the service-role
-- key publishStatus() itself uses to publish, which continues to bypass
-- RLS entirely as intended, per supabase.ts's own documented rationale
-- for why the backend always writes as the service role).
--
-- SESSION channel: owned by practice_sessions.user_id — matches
-- session.service.ts's existing "sessions are strictly user-private"
-- model (getSessionById's 403-not-404 ownership check).
--
-- PERSONA channel: personas are workspace-shared/reusable by design (see
-- FINAL_BACKEND_AUDIT.md's Open Question 3 / FRONTEND_READINESS_CHECKLIST.
-- md — confirmed intentional, not an oversight), so the check here is
-- "any active member of the owning workspace," not "the creating user
-- only" — matching every other persona read/write path in this codebase.

alter table realtime.messages enable row level security;

-- FIX applied during authoring, not after: an earlier draft of this
-- migration used two separate policies (one per channel type), each
-- falling through to `true` for topics it didn't recognize as its own
-- prefix. Under Postgres RLS, multiple PERMISSIVE policies on the same
-- command are OR'd together — so the session policy's "true" fallback
-- for any non-session topic would have unconditionally granted access to
-- every persona-topic row too, completely neutralizing the persona
-- policy's real check (true OR anything = true). Collapsed into one
-- policy with a single CASE expression instead, so there is exactly one
-- decision per row with no cross-policy OR to exploit. The fallback for
-- any topic prefix that is neither 'session' nor 'persona' — including a
-- topic with no ':' at all — is FALSE (deny), fail-closed: this table is
-- entirely populated by channels this app controls the naming of (see
-- realtime/channels.ts's own `channel: 'session' | 'persona'` type), so
-- there is no legitimate third case that should ever need access.
create policy "broadcast_channel_subscribe_authorized_only"
on realtime.messages
for select
to authenticated
using (
  case split_part(topic, ':', 1)
    when 'session' then
      exists (
        select 1 from practice_sessions ps
        where ps.id::text = split_part(topic, ':', 2)
          and ps.user_id = auth.uid()
      )
    when 'persona' then
      -- Personas are workspace-shared/reusable by design (see
      -- FINAL_BACKEND_AUDIT.md's Open Question 3 / FRONTEND_READINESS_
      -- CHECKLIST.md — confirmed intentional, not an oversight), so this
      -- checks "any active member of the owning workspace," matching
      -- every other persona read/write path in this codebase, not
      -- "the creating user only" the way the session branch above does.
      exists (
        select 1 from personas p
        join workspace_members wm on wm.workspace_id = p.workspace_id
        where p.id::text = split_part(topic, ':', 2)
          and wm.user_id = auth.uid()
          and wm.status = 'active'
      )
    else false
  end
);
