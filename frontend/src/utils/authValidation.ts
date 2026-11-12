/**
 * Inline validators mirroring the backend's own zod bounds (architecture
 * doc §7.1, confirmed against backend/src/modules/auth/auth.schemas.ts):
 * password 8-72 chars, email format. Kept as plain functions rather than a
 * zod schema — the bounds are few and simple enough not to warrant the
 * dependency yet (see architecture doc §11.9 on keeping these in sync by
 * hand if the backend's bounds ever change).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | undefined {
  if (!email.trim()) return 'Email is required';
  if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address';
  return undefined;
}

export function validatePassword(password: string): string | undefined {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 72) return 'Password must be 72 characters or fewer';
  return undefined;
}
