-- 0002_identity_workspace.sql

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid, -- FK added after users table exists (circular reference)
  plan_id uuid, -- FK added in 0005 once plans exists
  seats_purchased int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger workspaces_set_updated_at before update on workspaces
  for each row execute function set_updated_at();

-- Extends auth.users 1:1. A trigger on auth.users could auto-insert this row,
-- but this backend creates it explicitly in auth.service.ts's
-- ensureProfileAndWorkspace() for both password signup and first OAuth login,
-- so behavior is identical and testable regardless of auth path.
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  current_workspace_id uuid references workspaces(id) on delete set null,
  email_verified_at timestamptz, -- DryRun's OWN verification gate, independent of auth.users.email_confirmed_at
  onboarding_completed_at timestamptz,
  is_admin boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();
create index users_deleted_at_idx on users (deleted_at) where deleted_at is not null;

alter table workspaces add constraint workspaces_owner_fk
  foreign key (owner_user_id) references users(id) on delete restrict;

create type workspace_role as enum ('owner', 'admin', 'member');
create type workspace_member_status as enum ('active', 'invited', 'removed');

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role workspace_role not null default 'member',
  status workspace_member_status not null default 'active',
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index workspace_members_user_idx on workspace_members (user_id);
create index workspace_members_workspace_idx on workspace_members (workspace_id);

create type invite_status as enum ('pending', 'accepted', 'expired', 'revoked');

create table workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  role workspace_role not null default 'member',
  token_hash text not null unique,
  status invite_status not null default 'pending',
  expires_at timestamptz not null,
  invited_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index workspace_invites_workspace_idx on workspace_invites (workspace_id);

create table email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_verification_tokens_user_idx on email_verification_tokens (user_id);

create table password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table notification_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  weekly_summary_enabled boolean not null default true,
  async_ready_push_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);
