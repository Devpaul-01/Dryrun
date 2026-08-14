-- =============================================================================
-- DryRun — Complete Database Schema
-- =============================================================================
-- This file is the definitive schema, reverse-engineered from every Supabase
-- query in the current codebase (config/, jobs/, middleware/, modules/).
--
-- PROVENANCE: No migration files existed prior to this pass. Every table,
-- column, and constraint below is either (a) directly evidenced by a
-- `.select()/.insert()/.update()/.eq()` call somewhere in the code, or
-- (b) marked "[INFERRED]" where the code implies a shape but never pins
-- down the exact type/constraint (e.g. a JSON blob's inner shape). Anywhere
-- I had to guess a constraint that isn't independently visible in two or
-- more call sites, I've called it out in a comment so you can sanity-check
-- it against your own intent before running this against production data.
--
-- ORDERING: tables are declared in dependency order so this file can be
-- run top-to-bottom on an empty database with FKs enabled throughout.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "pg_trgm";        -- trigram search backing session title/search_vector

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
-- Kept as CHECK constraints rather than native enums in several places below
-- (workspace_role, session status, etc.) because the codebase treats them as
-- plain strings compared with `.eq()`, and CHECK is far cheaper to extend
-- later (ALTER TYPE ... ADD VALUE cannot run in a transaction; CHECK can be
-- dropped/re-added in one). True Postgres enums are used only where the
-- value set is small, stable, and referenced by exactly one column.

create type workspace_role as enum ('owner', 'admin', 'member');
create type workspace_member_status as enum ('active', 'removed');
create type invite_status as enum ('pending', 'accepted', 'expired');

create type session_status as enum ('pending', 'active', 'completed');
create type difficulty_level as enum ('beginner', 'standard', 'advanced', 'expert');
create type message_role as enum ('user', 'buyer', 'system');
-- monologue_severity / validation_status kept as text+CHECK — see below,
-- these values are asserted directly against a Zod enum in outputValidator.ts
-- and ai.service.ts, so a CHECK mirroring that enum is the correctly-scoped
-- level of strictness (Zod is the source of truth; DB is defense-in-depth).

create type persona_source_kind as enum ('pasted_text', 'url', 'upload');
create type persona_source_status as enum ('pending', 'extracted', 'extraction_failed', 'synthesized');
create type persona_source_type as enum ('generated', 'combined', 'company_url', 'document');

create type upload_purpose as enum ('persona_source', 'session_context');
create type upload_status as enum ('uploaded', 'processing', 'processed', 'failed');
create type av_scan_status as enum ('pending', 'clean', 'flagged');

create type subscription_status as enum ('incomplete', 'active', 'past_due', 'canceled');
create type notification_channel as enum ('email', 'push', 'in_app');

-- =============================================================================
-- Identity & Workspace
-- =============================================================================

-- `users` mirrors (a subset of) auth.users, keyed 1:1 by the same UUID
-- (authenticate.ts inserts with `id: authUserId` from Supabase Auth directly —
-- never a separately generated id). This is why there's no default on `id`.
create table users (
  id                          uuid primary key references auth.users(id) on delete cascade,
  email                       text not null unique,
  display_name                text,
  current_workspace_id        uuid, -- FK added after workspaces exists (circular dependency)
  email_verified_at           timestamptz,
  onboarding_completed_at     timestamptz,
  is_admin                    boolean not null default false,
  deleted_at                  timestamptz,       -- soft-delete; purged by purgeSoftDeletedAccounts worker after grace period
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index idx_users_email on users (email);
create index idx_users_deleted_at on users (deleted_at) where deleted_at is not null; -- purge-job scan

create table workspaces (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  owner_user_id       uuid references users(id) on delete set null,
  plan_id             uuid, -- FK added after `plans` exists
  seats_purchased     integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table users
  add constraint fk_users_current_workspace
  foreign key (current_workspace_id) references workspaces(id) on delete set null;

create index idx_workspaces_owner on workspaces (owner_user_id);

create table workspace_members (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  role            workspace_role not null default 'member',
  status          workspace_member_status not null default 'active',
  joined_at       timestamptz,
  created_at      timestamptz not null default now(),
  unique (workspace_id, user_id)
);

-- resolveWorkspace.ts filters `eq('user_id', ...).eq('workspace_id', ...)` on
-- every authenticated request — this is the hottest index in the schema.
create index idx_workspace_members_user_workspace on workspace_members (user_id, workspace_id);
create index idx_workspace_members_workspace_status on workspace_members (workspace_id, status);

create table workspace_invites (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  email           text not null,
  role            workspace_role not null check (role in ('admin', 'member')), -- owner is never invited, only transferred
  token_hash      text not null unique,
  status          invite_status not null default 'pending',
  invited_by      uuid not null references users(id) on delete cascade,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
);

create index idx_workspace_invites_token_hash on workspace_invites (token_hash);
create index idx_workspace_invites_workspace_status on workspace_invites (workspace_id, status);

-- =============================================================================
-- Billing
-- =============================================================================

create table plans (
  id                      uuid primary key default gen_random_uuid(),
  key                     text not null unique, -- 'free', 'pro', etc — looked up by key in billing.service/entitlements
  name                    text not null,
  price_amount            numeric(10, 2) not null,
  currency                text not null default 'USD',
  session_limit_per_month integer,               -- null = unlimited (checked via `== null` in entitlements.ts)
  features               jsonb not null default '{}'::jsonb, -- [INFERRED shape] { persona_from_document: bool, playbook_limit: number|null, voice_mode: bool }
  is_active               boolean not null default true,
  created_at              timestamptz not null default now()
);

alter table workspaces
  add constraint fk_workspaces_plan
  foreign key (plan_id) references plans(id) on delete set null;

create index idx_plans_key on plans (key);
create index idx_plans_active_price on plans (is_active, price_amount);

create table subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references workspaces(id) on delete cascade,
  plan_id                 uuid not null references plans(id),
  provider                text not null default 'flutterwave', -- PaymentProvider.name; new providers just add a value here
  provider_customer_id    text,
  -- The provider's transaction reference generated at checkout-initiation
  -- time (flutterwave.provider.ts's initiateCharge builds this) — stored
  -- so confirmCheckout can match a verified transaction back to the EXACT
  -- pending subscription row it belongs to, rather than guessing via
  -- "most recent incomplete row for this workspace" (a real race
  -- condition if a workspace ever has more than one incomplete attempt
  -- at once — see billing.service.ts's confirmCheckout for the full fix).
  -- Cleared (set to null) once a checkout resolves either way (activated
  -- or superseded), so it's never stale for a future incomplete attempt.
  pending_tx_ref          text,
  status                  subscription_status not null default 'incomplete',
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  canceled_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- entitlements.ts / billing.service.ts always take "most recent subscription
-- row for this workspace" via order-by-created_at-desc-limit-1 — never a
-- unique constraint on workspace_id, because a workspace's subscription
-- history (incomplete -> active -> canceled -> re-subscribed) is multiple rows.
create index idx_subscriptions_workspace_created on subscriptions (workspace_id, created_at desc);
create index idx_subscriptions_provider_created on subscriptions (provider, created_at desc); -- processWebhookEvent.worker's lookup
create unique index uq_subscriptions_pending_tx_ref on subscriptions (pending_tx_ref) where pending_tx_ref is not null; -- confirmCheckout's exact-match lookup

create table payment_transactions (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  subscription_id     uuid references subscriptions(id) on delete set null,
  provider_tx_ref     text not null,
  amount              numeric(10, 2),
  currency            text,
  status              text not null, -- 'successful' is the only value written today; kept text for provider-specific statuses
  raw_payload         jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index idx_payment_transactions_workspace_created on payment_transactions (workspace_id, created_at desc);
create unique index uq_payment_transactions_provider_tx_ref on payment_transactions (provider_tx_ref);

create table webhook_events (
  id                    uuid primary key default gen_random_uuid(),
  provider              text not null,
  provider_event_id     text not null,
  event_type            text not null,
  payload               jsonb not null,
  processed             boolean not null default false,
  processed_at          timestamptz,
  signature_verified    boolean not null default false,
  created_at            timestamptz not null default now(),
  -- webhook.routes.ts relies on a unique-constraint violation on this pair to
  -- detect duplicate provider deliveries and no-op them (idempotent webhook receipt).
  unique (provider, provider_event_id)
);

create table webhook_signature_failures (
  id            uuid primary key default gen_random_uuid(),
  source_ip     text,
  raw_headers   jsonb,
  created_at    timestamptz not null default now()
);

create index idx_webhook_sig_failures_created on webhook_signature_failures (created_at desc); -- spike-detection window scan

create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references workspaces(id) on delete cascade,
  actor_user_id   uuid references users(id) on delete set null,
  action          text not null,
  target_type     text not null,
  target_id       text not null, -- text, not uuid: targets span multiple entity types (subscription, workspace_member, user, workspace)
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index idx_audit_log_workspace_created on audit_log (workspace_id, created_at desc);
create index idx_audit_log_actor_created on audit_log (actor_user_id, created_at desc);

-- =============================================================================
-- System configuration
-- =============================================================================

create table system_config (
  key           text primary key,
  value         jsonb not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references users(id) on delete set null
);

-- =============================================================================
-- Practice profiles, personas, sessions
-- =============================================================================

-- NOTE re item #9 in the refinement request ("scope practice_profiles by
-- user_id"): the table already carries user_id and the existing unique
-- constraint is (user_id, workspace_id), and every read/write in
-- onboarding.routes.ts, session.service.ts, and demo.service.ts already
-- filters by both. See the Stage-9 write-up for what actually changes.
create table practice_profiles (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  workspace_id          uuid not null references workspaces(id) on delete cascade,
  product_description   text not null,
  target_audience        text not null,
  tone_preference        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, workspace_id)
);

create index idx_practice_profiles_user_workspace on practice_profiles (user_id, workspace_id);

create table personas (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references workspaces(id) on delete cascade,
  created_by_user_id      uuid references users(id) on delete set null,
  name                    text not null,
  role                    text not null,
  company_context         text default '',
  main_pain               text not null default '',
  skepticism_about        text not null default '',
  communication_style     text not null default 'professional and direct',
  hidden_motivations      jsonb not null default '[]'::jsonb, -- text[] in practice; jsonb to match AI-generated array shape directly
  source_type             persona_source_type not null default 'generated',
  reusable                boolean not null default true,
  deleted_at              timestamptz, -- soft-delete (personas.deletePersona)
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index idx_personas_workspace_created on personas (workspace_id, created_at desc) where deleted_at is null;

create table persona_sources (
  id                      uuid primary key default gen_random_uuid(),
  persona_id              uuid not null references personas(id) on delete cascade,
  source_kind             persona_source_kind not null,
  raw_reference           text not null, -- pasted text itself, a URL, or an uploads.id depending on source_kind
  extracted_text          text,
  status                  persona_source_status not null default 'pending',
  contains_flagged_pii    boolean not null default false,
  created_at              timestamptz not null default now()
);

create index idx_persona_sources_persona on persona_sources (persona_id);

create table practice_sessions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references users(id) on delete cascade,
  workspace_id              uuid not null references workspaces(id) on delete cascade,
  persona_id                uuid references personas(id) on delete set null,
  persona_snapshot          jsonb not null default '{}'::jsonb, -- frozen copy at session-start time; personas can change after
  scenario_type             text not null,   -- validated against scenario.config.ts's SCENARIO_TYPES at the app layer, not DB
  pressure_modifiers        jsonb not null default '[]'::jsonb, -- text[] of PressureModifierType, max 2 stacked (app-layer rule)
  difficulty_level          difficulty_level not null default 'beginner',
  status                    session_status not null default 'pending',
  title                     text,
  retry_of_session_id       uuid references practice_sessions(id) on delete set null,
  is_demo                   boolean not null default false,
  archived_at               timestamptz,
  started_at                timestamptz,
  completed_at              timestamptz,
  search_vector             tsvector, -- backs session.routes.ts's `.textSearch('search_vector', search)`
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index idx_sessions_user_workspace_created on practice_sessions (user_id, workspace_id, created_at desc);
create index idx_sessions_workspace_created on practice_sessions (workspace_id, created_at desc);
create index idx_sessions_user_status on practice_sessions (user_id, status);
create index idx_sessions_archived on practice_sessions (user_id, workspace_id, archived_at);
create index idx_sessions_search_vector on practice_sessions using gin (search_vector);
create index idx_sessions_completed_at on practice_sessions (completed_at) where status = 'completed'; -- archiveOldSnapshots cutoff scan

create trigger trg_sessions_search_vector
  before insert or update of title, scenario_type on practice_sessions
  for each row execute function
    tsvector_update_trigger(search_vector, 'pg_catalog.english', title, scenario_type);

create table session_goals (
  session_id      uuid primary key references practice_sessions(id) on delete cascade,
  goal_type       text not null, -- GOAL_TYPES in scenario.config.ts
  custom_text     text,
  -- goal_progress (a 0-100 AI-generated score) was removed in favor of a
  -- direct achievement judgment — the model was never given per-goal-type
  -- anchoring for what a given number meant, making the score an
  -- uncalibrated proxy. goal_achieved below is now set directly from the
  -- model's own yes/no judgment (see promptBuilder.ts's per-goal-type
  -- criteria and session.service.ts's sendMessage()).
  --
  -- MIGRATION: if goal_progress already exists on a running database,
  -- drop it manually once deployed — deliberately not auto-executed here:
  --   alter table session_goals drop column if exists goal_progress;
  goal_achieved   boolean, -- written by session.service.ts's sendMessage() once the AI judges the goal achieved; sticky — never reset back to false/null once true
  created_at      timestamptz not null default now()
);

create table session_messages (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references practice_sessions(id) on delete cascade,
  role                  message_role not null,
  content               text not null,
  internal_monologue    text,
  monologue_severity    text check (monologue_severity in ('positive', 'neutral', 'negative')),
  sequence_index        integer not null,
  created_at            timestamptz not null default now(),
  unique (session_id, sequence_index)
);

create index idx_session_messages_session_seq on session_messages (session_id, sequence_index);

create table session_message_attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references session_messages(id) on delete cascade,
  upload_id     uuid not null references uploads(id) on delete cascade,
  created_at    timestamptz not null default now()
);

create index idx_session_msg_attachments_message on session_message_attachments (message_id);

create table session_state_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  session_id              uuid not null references practice_sessions(id) on delete cascade,
  message_id              uuid references session_messages(id) on delete set null,
  interest                numeric(5, 2) not null,
  trust                   numeric(5, 2) not null,
  confusion               numeric(5, 2) not null,
  buying_intent           numeric(5, 2) not null default 0,
  objection_likelihood    numeric(5, 2) not null default 0,
  momentum                numeric(6, 3) not null default 0,
  prompt_version          text not null,
  sequence_index          integer not null,
  created_at              timestamptz not null default now(),
  unique (session_id, sequence_index)
);

create index idx_session_snapshots_session_seq on session_state_snapshots (session_id, sequence_index);

create table session_context_summaries (
  session_id                    uuid primary key references practice_sessions(id) on delete cascade,
  summary_text                  text not null,
  covers_up_to_sequence_index   integer not null,
  created_at                    timestamptz not null default now()
);

create table session_debriefs (
  session_id          uuid primary key references practice_sessions(id) on delete cascade,
  strength            text not null,
  improvement         text not null,
  coachable_moment    text not null,
  goal_reference      text,
  generated_at        timestamptz not null default now()
);

create table session_skill_scores (
  session_id            uuid primary key references practice_sessions(id) on delete cascade,
  clarity               numeric(5, 2) not null,
  value                 numeric(5, 2) not null,
  discovery             numeric(5, 2) not null,
  objection_handling    numeric(5, 2) not null,
  brevity               numeric(5, 2) not null,
  cta_strength          numeric(5, 2) not null,
  composite_score       numeric(5, 2) not null,
  weakest_axis          text not null,
  strongest_axis        text not null,
  created_at            timestamptz not null default now()
);

create table session_retries (
  retry_session_id    uuid primary key references practice_sessions(id) on delete cascade,
  -- Written by scoring.service.ts's computeSessionComparison(), triggered
  -- both automatically (scoreSessionSkills.worker.ts, right after a retry
  -- session's own scoring completes) and on-demand (GET /:id/comparison,
  -- as a fallback if the background path hasn't run yet). Shape:
  -- { original_scores, retry_scores, deltas, original_goal_achieved,
  --   retry_goal_achieved, summary } — see SessionComparisonPayload in
  -- scoring.service.ts for the exact TypeScript type.
  comparison          jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create table user_skill_trend (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  composite_avg     numeric(5, 2) not null,
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  sessions_count    integer not null default 0,
  created_at        timestamptz not null default now()
);

create index idx_user_skill_trend_user_workspace_period on user_skill_trend (user_id, workspace_id, period_start desc);
create index idx_user_skill_trend_workspace_period on user_skill_trend (workspace_id, period_start desc); -- team-progress aggregate scan

create table curriculum_plans (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  workspace_id          uuid not null references workspaces(id) on delete cascade,
  weakness_identified   text not null,
  sessions              jsonb not null default '[]'::jsonb, -- [INFERRED shape] array of {session_number, focus_axis|scenario_type, type}
  status                text not null default 'active' check (status in ('active', 'dismissed')),
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now()
);

create index idx_curriculum_plans_user_workspace_status on curriculum_plans (user_id, workspace_id, status, created_at desc);

create table badges (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  workspace_id          uuid not null references workspaces(id) on delete cascade,
  badge_type            text not null,
  badge_label           text not null,
  badge_description     text not null,
  earned_at             timestamptz not null default now(),
  unique (user_id, badge_type)
);

create index idx_badges_user_earned on badges (user_id, earned_at desc);

-- =============================================================================
-- Playbooks
-- =============================================================================

create table playbooks (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references workspaces(id) on delete cascade,
  created_by_user_id        uuid references users(id) on delete set null,
  title                     text not null,
  current_version_id        uuid, -- FK added after playbook_versions exists (circular dependency)
  share_token               text unique,
  share_attribution_enabled boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table playbook_versions (
  id                        uuid primary key default gen_random_uuid(),
  playbook_id               uuid not null references playbooks(id) on delete cascade,
  version_number            integer not null,
  opening_message           text not null,
  discovery_questions       jsonb not null default '[]'::jsonb,
  objection_responses       jsonb not null default '[]'::jsonb, -- [{objection, response}]
  closing_cta               text not null,
  key_insight               text not null,
  created_at                timestamptz not null default now(),
  unique (playbook_id, version_number)
);

alter table playbooks
  add constraint fk_playbooks_current_version
  foreign key (current_version_id) references playbook_versions(id) on delete set null;

create index idx_playbooks_workspace_created on playbooks (workspace_id, created_at desc);
create index idx_playbook_versions_playbook on playbook_versions (playbook_id, version_number desc);
create index idx_playbooks_share_token on playbooks (share_token) where share_token is not null;

-- =============================================================================
-- AI observability
-- =============================================================================

create table ai_scoring_evaluations (
  id                        uuid primary key default gen_random_uuid(),
  session_id                uuid references practice_sessions(id) on delete cascade, -- nullable: demo sessions use a synthetic session id and skip this FK write entirely
  message_id                uuid references session_messages(id) on delete set null,
  raw_response              jsonb not null,
  validation_status         text not null check (validation_status in ('accepted', 'rejected_retried', 'rejected_fallback')),
  accepted_delta            jsonb, -- null when validation_status = 'rejected_fallback'
  reasoning                 text,
  prompt_version            text not null,
  sampled_for_human_review  boolean not null default false,
  flagged_for_review        boolean not null default false,
  created_at                timestamptz not null default now()
);

create index idx_ai_scoring_evals_created on ai_scoring_evaluations (created_at desc);
create index idx_ai_scoring_evals_sample_pending on ai_scoring_evaluations (created_at) where sampled_for_human_review = false;
create index idx_ai_scoring_evals_sampled on ai_scoring_evaluations (sampled_for_human_review, created_at desc);

create table ai_usage_log (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  call_type         text not null check (call_type in ('live_turn', 'persona_synthesis', 'debrief', 'scoring', 'playbook', 'consistency_check')),
  provider          text not null,
  model             text not null,
  tokens_in         integer not null default 0,
  tokens_out        integer not null default 0,
  created_at        timestamptz not null default now()
);

create index idx_ai_usage_log_workspace_created on ai_usage_log (workspace_id, created_at desc);

-- =============================================================================
-- Uploads
-- =============================================================================

create table uploads (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  user_id             uuid not null references users(id) on delete cascade,
  purpose             upload_purpose not null,
  storage_path        text not null,
  original_filename   text not null,
  mime_type           text not null,
  size_bytes          bigint not null,
  status              upload_status not null default 'uploaded',
  av_scan_status      av_scan_status not null default 'pending',
  created_at          timestamptz not null default now()
);

create index idx_uploads_workspace on uploads (workspace_id);
create index idx_uploads_status_created on uploads (status, created_at) where status = 'uploaded'; -- orphan-purge scan

-- =============================================================================
-- Notifications
-- =============================================================================

create table notification_preferences (
  user_id                       uuid primary key references users(id) on delete cascade,
  weekly_summary_enabled        boolean not null default true,
  async_ready_push_enabled      boolean not null default false,
  updated_at                    timestamptz not null default now()
);

create table notifications_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  channel       notification_channel not null,
  type          text not null,
  payload       jsonb not null default '{}'::jsonb,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index idx_notifications_log_user_created on notifications_log (user_id, created_at desc);
create index idx_notifications_log_user_unread on notifications_log (user_id) where read_at is null;

create table push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  token         text not null,
  updated_at    timestamptz not null default now(),
  unique (user_id, token)
);

-- =============================================================================
-- Demo sessions (anonymous, pre-signup)
-- =============================================================================

create table demo_sessions (
  id                      uuid primary key default gen_random_uuid(),
  demo_token_hash         text not null unique,
  ip_hash                 text not null,
  fingerprint_hash        text not null,
  persona_snapshot        jsonb not null,
  messages                jsonb not null default '[]'::jsonb, -- [{role, content, internal_monologue?}]
  converted_to_user_id    uuid references users(id) on delete set null,
  expires_at              timestamptz not null,
  created_at              timestamptz not null default now()
);

create index idx_demo_sessions_expires on demo_sessions (expires_at); -- purgeExpiredDemoSessions scan

-- =============================================================================
-- Analytics
-- =============================================================================

create table analytics_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references users(id) on delete set null,
  workspace_id    uuid references workspaces(id) on delete set null,
  session_id      uuid references practice_sessions(id) on delete set null,
  event_name      text not null,
  properties      jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now()
);

create index idx_analytics_events_workspace_occurred on analytics_events (workspace_id, occurred_at desc);
create index idx_analytics_events_name_occurred on analytics_events (event_name, occurred_at desc);

-- =============================================================================
-- Auth token tables — RETIRED as of the Supabase-native email migration
-- =============================================================================
-- email_verification_tokens and password_reset_tokens (previously declared
-- here) are no longer used by any application code as of this migration.
-- modules/auth/auth.service.ts now uses Supabase's own token lifecycle
-- (admin.generateLink + verifyOtp for email confirmation, since
-- admin.createUser never triggers Supabase's own email sending regardless
-- of settings; resetPasswordForEmail + the Send Email Hook for password
-- reset, since that IS a genuine Supabase-mailer-triggering flow) — see
-- that file's header comment for the full rationale of why two different
-- mechanisms are used for what looks like the same kind of token.
--
-- MIGRATION: these DROP statements are deliberately written out (not
-- silently omitted) so a real running database's history stays honest —
-- run this against an existing production database only after confirming
-- no in-flight verification/reset email sent under the old flow is still
-- unconsumed (any token issued under the old system becomes unusable the
-- moment this runs, same as any client already mid-flow when the backend
-- deploys this migration would be after redeploying the app code alone).
--
--   drop table if exists email_verification_tokens;
--   drop table if exists password_reset_tokens;
--
-- Left commented-out rather than executed unconditionally in this file,
-- since running it is a one-way migration step that should be applied
-- deliberately alongside the corresponding application deploy, not
-- bundled invisibly into a full from-scratch schema run.

-- =============================================================================
-- updated_at maintenance trigger (applied to every table with the column)
-- =============================================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format(
      'create trigger trg_set_updated_at before update on %I for each row execute function set_updated_at();',
      t
    );
  end loop;
end $$;

-- =============================================================================
-- Row-Level Security
-- =============================================================================
-- Per supabase.ts's own documented rationale: the API/worker tiers use the
-- service-role key and bypass RLS by design; application code does its own
-- workspace-scoping. RLS here is the last-line defense described in that
-- file's comment (architecture doc §7.3/§19.10), for any future query path
-- (e.g. a client-side Supabase SDK call) that might bypass the Express layer.
-- Enabling RLS with NO permissive policies means only the service role
-- (which bypasses RLS entirely) can read/write — anon/authenticated roles
-- get zero access unless a policy is explicitly added.

alter table users enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table workspace_invites enable row level security;
alter table practice_profiles enable row level security;
alter table personas enable row level security;
alter table persona_sources enable row level security;
alter table practice_sessions enable row level security;
alter table session_goals enable row level security;
alter table session_messages enable row level security;
alter table session_message_attachments enable row level security;
alter table session_state_snapshots enable row level security;
alter table session_context_summaries enable row level security;
alter table session_debriefs enable row level security;
alter table session_skill_scores enable row level security;
alter table session_retries enable row level security;
alter table user_skill_trend enable row level security;
alter table curriculum_plans enable row level security;
alter table badges enable row level security;
alter table playbooks enable row level security;
alter table playbook_versions enable row level security;
alter table ai_scoring_evaluations enable row level security;
alter table ai_usage_log enable row level security;
alter table uploads enable row level security;
alter table notification_preferences enable row level security;
alter table notifications_log enable row level security;
alter table push_tokens enable row level security;
alter table demo_sessions enable row level security;
alter table analytics_events enable row level security;
alter table subscriptions enable row level security;
alter table payment_transactions enable row level security;
alter table webhook_events enable row level security;
alter table webhook_signature_failures enable row level security;
alter table audit_log enable row level security;
alter table system_config enable row level security;
alter table plans enable row level security;

-- `plans` is the one table safe to expose read-only to authenticated users
-- directly (billing.routes.ts's GET /plans has no side-effect risk and this
-- mirrors a plausible future client-side read), so it gets a real policy
-- rather than a full lockout. Everything else stays service-role-only.
create policy plans_public_read on plans for select to authenticated using (is_active = true);
