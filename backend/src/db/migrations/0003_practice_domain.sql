-- 0003_practice_domain.sql

create table practice_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_description text not null,
  target_audience text not null,
  tone_preference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workspace_id)
);
create trigger practice_profiles_set_updated_at before update on practice_profiles
  for each row execute function set_updated_at();

create type persona_source_type as enum
  ('generated', 'linkedin_text', 'company_url', 'sales_page', 'job_description', 'email_thread', 'document', 'image', 'combined');

create table personas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by_user_id uuid references users(id),
  name text not null,
  role text not null,
  company_context text,
  main_pain text not null default '',
  skepticism_about text not null default '',
  communication_style text default 'professional and direct',
  hidden_motivations jsonb not null default '[]',
  source_type persona_source_type not null default 'generated',
  reusable boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(name,'') || ' ' || coalesce(role,'') || ' ' || coalesce(company_context,''))
  ) stored
);
create trigger personas_set_updated_at before update on personas
  for each row execute function set_updated_at();
create index personas_workspace_idx on personas (workspace_id);
create index personas_search_idx on personas using gin (search_vector);

create type persona_source_kind as enum ('pasted_text', 'url', 'upload');
create type persona_source_status as enum ('pending', 'extracted', 'extraction_failed', 'synthesized');

create table persona_sources (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references personas(id) on delete cascade,
  source_kind persona_source_kind not null,
  raw_reference text not null, -- pasted text, a URL, or an uploads.id (as text)
  extracted_text text,
  status persona_source_status not null default 'pending',
  contains_flagged_pii boolean not null default false,
  created_at timestamptz not null default now()
);
create index persona_sources_persona_idx on persona_sources (persona_id);

create type upload_purpose as enum ('persona_source', 'session_context');
create type upload_status as enum ('uploaded', 'processing', 'processed', 'failed');
create type av_scan_status as enum ('pending', 'clean', 'flagged');

create table uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id),
  purpose upload_purpose not null,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes int not null,
  av_scan_status av_scan_status not null default 'pending',
  status upload_status not null default 'uploaded',
  created_at timestamptz not null default now()
);
create index uploads_workspace_idx on uploads (workspace_id);
create index uploads_status_idx on uploads (status);

create type scenario_type as enum
  ('cold_open', 'skeptic', 'price_pushback', 'bad_timing', 'long_goodbye', 'radio_silence', 'drill');
create type session_status as enum ('pending', 'active', 'completed', 'abandoned');

create table practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  persona_id uuid references personas(id) on delete set null,
  -- Denormalized snapshot of the persona AT SESSION START, so a replay
  -- always reflects the buyer actually practiced against, even if the
  -- source persona is later edited or deleted (architecture doc 3.7 note).
  persona_snapshot jsonb,
  scenario_type scenario_type not null,
  pressure_modifiers jsonb not null default '[]', -- product-rule max-2 cap enforced at the service layer
  difficulty_level text not null default 'standard',
  title text,
  status session_status not null default 'pending',
  archived_at timestamptz,
  is_demo boolean not null default false,
  retry_of_session_id uuid references practice_sessions(id) on delete set null,
  goal_achieved boolean,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(title,'') || ' ' || coalesce(scenario_type::text,''))
  ) stored
);
create trigger practice_sessions_set_updated_at before update on practice_sessions
  for each row execute function set_updated_at();
create index practice_sessions_user_created_idx on practice_sessions (user_id, created_at desc, id desc);
create index practice_sessions_workspace_idx on practice_sessions (workspace_id);
create index practice_sessions_active_idx on practice_sessions (archived_at) where archived_at is null;
create index practice_sessions_search_idx on practice_sessions using gin (search_vector);

create table session_goals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references practice_sessions(id) on delete cascade,
  goal_type text not null,
  custom_text text,
  goal_progress numeric(5,2),
  goal_achieved boolean,
  created_at timestamptz not null default now()
);

create type message_role as enum ('user', 'buyer', 'system');
create type monologue_severity as enum ('positive', 'neutral', 'negative');

create table session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references practice_sessions(id) on delete cascade,
  role message_role not null,
  content text not null,
  internal_monologue text, -- buyer-only, hidden until post-session replay
  monologue_severity monologue_severity,
  sequence_index int not null,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (to_tsvector('english', coalesce(content,''))) stored,
  unique (session_id, sequence_index)
);
create index session_messages_session_idx on session_messages (session_id, sequence_index);
create index session_messages_search_idx on session_messages using gin (search_vector);

create table session_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references session_messages(id) on delete cascade,
  upload_id uuid not null references uploads(id),
  created_at timestamptz not null default now(),
  unique (message_id, upload_id)
);

create table session_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references practice_sessions(id) on delete cascade,
  message_id uuid references session_messages(id) on delete set null,
  interest numeric(5,2) not null,
  trust numeric(5,2) not null,
  confusion numeric(5,2) not null,
  buying_intent numeric(5,2) not null default 0,
  objection_likelihood numeric(5,2) not null default 0,
  momentum numeric(5,2) not null default 0, -- server-computed, never AI-generated
  prompt_version text not null,
  sequence_index int not null,
  created_at timestamptz not null default now()
);
create index session_state_snapshots_session_idx on session_state_snapshots (session_id, sequence_index);

-- Background conversation-summarization feature: one live summary per
-- session, superseding the previous one on regeneration (never an
-- unbounded pile of stale summaries -- see summarizeConversation.worker.ts).
create table session_context_summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references practice_sessions(id) on delete cascade,
  summary_text text not null,
  covers_up_to_sequence_index int not null,
  created_at timestamptz not null default now()
);

create table session_debriefs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references practice_sessions(id) on delete cascade,
  strength text not null,
  improvement text not null,
  coachable_moment text not null,
  goal_reference text,
  generated_at timestamptz not null default now()
);

create table session_skill_scores (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references practice_sessions(id) on delete cascade,
  clarity numeric(5,2) not null,
  value numeric(5,2) not null,
  discovery numeric(5,2) not null,
  objection_handling numeric(5,2) not null,
  brevity numeric(5,2) not null,
  cta_strength numeric(5,2) not null,
  composite_score numeric(5,2) not null,
  weakest_axis text,
  strongest_axis text,
  created_at timestamptz not null default now()
);

create table user_skill_trend (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  composite_avg numeric(5,2) not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  sessions_count int not null,
  created_at timestamptz not null default now()
);
create index user_skill_trend_user_idx on user_skill_trend (user_id, workspace_id, period_start desc);

create table curriculum_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  weakness_identified text,
  sessions jsonb not null default '[]',
  status text not null default 'active',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete set null,
  badge_type text not null,
  badge_label text not null,
  badge_description text,
  earned_at timestamptz not null default now()
);
create index badges_user_idx on badges (user_id);

create table playbooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by_user_id uuid references users(id),
  title text not null,
  current_version_id uuid, -- FK added after playbook_versions exists
  share_token text unique,
  share_attribution_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger playbooks_set_updated_at before update on playbooks
  for each row execute function set_updated_at();
create index playbooks_workspace_idx on playbooks (workspace_id);

create table playbook_versions (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references playbooks(id) on delete cascade,
  version_number int not null,
  opening_message text not null,
  discovery_questions jsonb not null default '[]',
  objection_responses jsonb not null default '[]',
  closing_cta text not null,
  key_insight text not null,
  created_at timestamptz not null default now(),
  unique (playbook_id, version_number)
);

alter table playbooks add constraint playbooks_current_version_id_fkey
  foreign key (current_version_id) references playbook_versions(id) on delete set null;

create table session_retries (
  id uuid primary key default gen_random_uuid(),
  original_session_id uuid not null references practice_sessions(id) on delete cascade,
  retry_session_id uuid not null references practice_sessions(id) on delete cascade,
  comparison jsonb,
  created_at timestamptz not null default now()
);

create table demo_sessions (
  id uuid primary key default gen_random_uuid(),
  demo_token_hash text not null unique,
  ip_hash text not null,
  fingerprint_hash text not null,
  persona_snapshot jsonb not null,
  messages jsonb not null default '[]',
  converted_to_user_id uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index demo_sessions_expires_idx on demo_sessions (expires_at);
