import * as Crypto from 'expo-crypto';

/**
 * Generates a fresh idempotency key for a new mutation attempt. Used by
 * sendMessage, createPlaybook, and regeneratePlaybook — the only three
 * documented idempotent-safe endpoints (architecture doc §4.1). React
 * Query's own retry of the *same* attempt must reuse one key, never
 * generate a fresh one on retry, so callers should generate this once per
 * logical attempt (e.g. once per composer submit) and pass it through,
 * not call this inside the mutation function itself.
 */
export function generateIdempotencyKey(): string {
  return Crypto.randomUUID();
}
