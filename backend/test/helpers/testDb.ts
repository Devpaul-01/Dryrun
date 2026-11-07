import { Client } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Real-Postgres test harness for the billing-reconciliation RPC suite.
 *
 * Mirrors exactly how this RPC's two real bugs (missing pending_tx_ref
 * column, the text/uuid audit_log cast — AUDIT.md Pass 1/Pass 3) were
 * originally found: stand up a real Postgres 16 database, apply every
 * migration in src/db/migrations/ in order from empty, and call the
 * actual SQL function with real data. A mocked Supabase client would
 * never have caught either bug — both were schema/SQL-level failures
 * invisible to anything short of a real database.
 *
 * Connection: reads TEST_DATABASE_URL (an admin connection string
 * pointing at a Postgres server this process may create/drop databases
 * on — e.g. postgresql://postgres:postgres@localhost:5432/postgres).
 * Defaults to a local trust/scram setup matching this dev container.
 * CI must set TEST_DATABASE_URL to a real Postgres service connection
 * string (see .github/workflows).
 *
 * Migration 0011_realtime_broadcast_authorization.sql is deliberately
 * skipped: it only touches `realtime.messages`, a Supabase-managed table
 * that doesn't exist on a plain Postgres instance and isn't needed by
 * anything the billing RPC touches. Every other migration applies
 * unmodified against a minimal `auth.users` / `auth.uid()` shim (created
 * below) standing in for the pieces of Supabase's own schema that RLS
 * policies in 0007 reference syntactically — those policy bodies are
 * stored, not executed, at CREATE POLICY time, so a real implementation
 * isn't needed, only a resolvable function signature.
 */

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'src', 'db', 'migrations');
const SKIPPED_MIGRATIONS = new Set(['0011_realtime_broadcast_authorization.sql']);

const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const TEST_DB_NAME = process.env.TEST_DB_NAME || 'dryrun_vitest';

function dbUrlFor(dbName: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/**
 * Drops and recreates the test database, then applies every migration
 * (in filename order) plus a minimal Supabase auth shim, and returns a
 * connected client against the fresh database. Call once per test file
 * in beforeAll — each file gets a fully clean database so billing-state
 * assertions never depend on leftover rows from another suite or a
 * prior run.
 */
export async function createFreshTestDb(): Promise<Client> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  // Terminate any lingering connections from a previous aborted run
  // before dropping, otherwise DROP DATABASE fails with "database is
  // being accessed by other users".
  await admin.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
    [TEST_DB_NAME]
  );
  await admin.query(`drop database if exists ${TEST_DB_NAME}`);
  await admin.query(`create database ${TEST_DB_NAME}`);
  await admin.end();

  const client = new Client({ connectionString: dbUrlFor(TEST_DB_NAME) });
  await client.connect();

  await client.query(`create extension if not exists pgcrypto;`);
  await client.query(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(),
      email text
    );
    create or replace function auth.uid() returns uuid
      language sql stable as $$ select null::uuid $$;
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !SKIPPED_MIGRATIONS.has(f))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await client.query(sql);
    } catch (err) {
      throw new Error(`Migration ${file} failed to apply: ${(err as Error).message}`);
    }
  }

  return client;
}

export async function dropTestDb(client: Client) {
  await client.end();
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
    [TEST_DB_NAME]
  );
  await admin.query(`drop database if exists ${TEST_DB_NAME}`);
  await admin.end();
}
