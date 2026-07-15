import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Service-role Supabase client for API and worker tiers.
 *
 * This client bypasses RLS, which is intentional: application code performs
 * its own workspace-scoping (`resolveWorkspace` middleware + explicit
 * `.eq('workspace_id', ...)` filters), while RLS remains the last-line
 * defense enforced at the database level for any query path that might ever
 * bypass application logic (see the RLS adversarial test suite requirement
 * in the architecture doc, §7.3 / §19.10).
 *
 * A second, anon-key client is deliberately NOT created here — this backend
 * never authenticates to Supabase as the end user; it verifies the user's
 * JWT itself (see middleware/authenticate.ts) and always queries as the
 * service role, applying workspace scoping explicitly.
 */
let _client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.supabase.url(), env.supabase.serviceRoleKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _client;
}
