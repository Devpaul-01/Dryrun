-- 0004_ai_integrity.sql

create type validation_status as enum ('accepted', 'rejected_retried', 'rejected_fallback');

-- The scoring-integrity audit trail -- the architecture's top-priority
-- reliability mechanism. Retained far longer than operational logs (see
-- README's retention notes) -- this is what makes "is scoring trustworthy"
-- an answerable question rather than an assumption.
create table ai_scoring_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references practice_sessions(id) on delete cascade,
  message_id uuid references session_messages(id) on delete set null,
  raw_response jsonb not null,
  validation_status validation_status not null,
  accepted_delta jsonb,
  reasoning text not null,
  prompt_version text not null,
  flagged_for_review boolean not null default false,
  sampled_for_human_review boolean not null default false,
  created_at timestamptz not null default now()
);
create index ai_scoring_evaluations_session_idx on ai_scoring_evaluations (session_id);
create index ai_scoring_evaluations_flagged_idx on ai_scoring_evaluations (flagged_for_review) where flagged_for_review = true;
create index ai_scoring_evaluations_sampled_idx on ai_scoring_evaluations (sampled_for_human_review) where sampled_for_human_review = true;

-- Token/cost accounting per call -- feeds the per-workspace AI budget check
-- and the AI-monitoring dashboard.
create table ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  call_type text not null,
  provider text not null,
  model text not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  created_at timestamptz not null default now()
);
create index ai_usage_log_workspace_idx on ai_usage_log (workspace_id, created_at desc);
