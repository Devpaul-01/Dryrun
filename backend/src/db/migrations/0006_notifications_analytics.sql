-- 0006_notifications_analytics.sql

create table notifications_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  channel text not null,
  type text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_log_user_idx on notifications_log (user_id, created_at desc, id desc);

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  workspace_id uuid references workspaces(id) on delete set null,
  session_id uuid references practice_sessions(id) on delete set null,
  event_name text not null,
  properties jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index analytics_events_name_idx on analytics_events (event_name, occurred_at desc);
create index analytics_events_workspace_idx on analytics_events (workspace_id, occurred_at desc);
-- Monthly partitioning is a reasonable future optimization once volume is
-- large (architecture doc 21) -- not required at MVP scale.
