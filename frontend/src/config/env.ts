/**
 * Centralized, validated access to build-time environment variables.
 * Everything here is EXPO_PUBLIC_* — inlined into the JS bundle, never a
 * secret (see .env.example). Fail loudly and early rather than letting a
 * missing var surface as a confusing runtime network error later.
 */

function readEnvVar(name: string, value: string | undefined, required: boolean): string {
  if (!value || value.length === 0) {
    if (required) {
      throw new Error(
        `Missing required environment variable ${name}. Copy frontend/.env.example to ` +
          `frontend/.env and fill it in, then restart the Expo dev server.`,
      );
    }
    return '';
  }
  return value;
}

const rawApiBaseUrl = readEnvVar(
  'EXPO_PUBLIC_API_BASE_URL',
  process.env.EXPO_PUBLIC_API_BASE_URL,
  true,
);

export const env = {
  /** Backend origin, e.g. http://localhost:3001 — no trailing slash. */
  apiBaseUrl: rawApiBaseUrl.replace(/\/+$/, ''),
  /** Full versioned API root, e.g. http://localhost:3001/api/v1 (architecture doc §2). */
  apiRoot: `${rawApiBaseUrl.replace(/\/+$/, '')}/api/v1`,
  supabaseUrl: readEnvVar(
    'EXPO_PUBLIC_SUPABASE_URL',
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    false,
  ),
  supabaseAnonKey: readEnvVar(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    false,
  ),
} as const;
