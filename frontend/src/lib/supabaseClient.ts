import { createClient } from '@supabase/supabase-js';

import { env } from '@/config/env';

/**
 * Supabase client — used for two things only (architecture doc §5):
 * the persona-generation-status Realtime subscription, and the Google
 * OAuth PKCE flow (§7.1, §11 open item). The app never talks to Supabase
 * for anything else; all other data access goes through the DryRun API
 * via httpClient. `persistSession: false` because this app's own
 * authStore/secureStorage own the session of record (the DryRun backend's
 * access/refresh tokens) — Supabase's client-side session storage would
 * just be a second, unused source of truth.
 *
 * Only constructed when the public env vars are present — Supabase usage
 * (Google sign-in, realtime) is an enhancement, not a hard requirement for
 * every build, matching M0's "placeholder env vars for now" decision.
 */
export const supabase = env.supabaseUrl && env.supabaseAnonKey
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        flowType: 'pkce',
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;
