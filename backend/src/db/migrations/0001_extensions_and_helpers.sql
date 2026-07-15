-- 0001_extensions_and_helpers.sql
-- Extensions and the shared updated_at trigger function used by every table.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
