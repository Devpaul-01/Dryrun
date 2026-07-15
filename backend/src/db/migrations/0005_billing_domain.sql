-- 0005_billing_domain.sql

create table plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  price_amount numeric(10,2) not null,
  currency text not null default 'USD',
  billing_interval text not null default 'monthly',
  seat_based boolean not null default false,
  session_limit_per_month int, -- null = unlimited
  features jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table workspaces add constraint workspaces_plan_fk
  foreign key (plan_id) references plans(id) on delete set null;

-- Seed the default tiers (see architecture doc 3.1 -- placeholder figures,
-- adjustable via this table without a code deploy).
insert into plans (key, name, price_amount, currency, billing_interval, seat_based, session_limit_per_month, features) values
  ('free', 'Free', 0, 'USD', 'monthly', false, 4, '{"persona_from_document": false, "playbook_limit": 1, "voice_mode": false}'),
  ('pro', 'Pro', 18, 'USD', 'monthly', false, null, '{"persona_from_document": true, "playbook_limit": null, "voice_mode": false}'),
  ('team', 'Team', 18, 'USD', 'monthly', true, null, '{"persona_from_document": true, "playbook_limit": null, "voice_mode": false}');

create type subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'incomplete');

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  plan_id uuid not null references plans(id),
  provider text not null default 'flutterwave',
  provider_customer_id text,
  provider_subscription_id text,
  status subscription_status not null default 'incomplete',
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now()
);
create index subscriptions_workspace_idx on subscriptions (workspace_id, created_at desc);

create table payment_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  provider_tx_ref text not null unique,
  amount numeric(10,2),
  currency text,
  status text not null,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);
create index payment_transactions_workspace_idx on payment_transactions (workspace_id, created_at desc);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed boolean not null default false,
  signature_verified boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id) -- the actual dedup constraint
);
create index webhook_events_processed_idx on webhook_events (processed) where processed = false;

create table webhook_signature_failures (
  id uuid primary key default gen_random_uuid(),
  source_ip text,
  raw_headers jsonb,
  created_at timestamptz not null default now()
);
create index webhook_signature_failures_created_idx on webhook_signature_failures (created_at desc);

create table system_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);
insert into system_config (key, value) values ('payment_enforcement_enabled', 'false');

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id) on delete set null,
  workspace_id uuid references workspaces(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_workspace_idx on audit_log (workspace_id, created_at desc);
create index audit_log_actor_idx on audit_log (actor_user_id, created_at desc);
