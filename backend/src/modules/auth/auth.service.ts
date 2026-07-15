import { randomBytes, createHash } from 'crypto';
import { supabaseAdmin } from '../../config/supabase';
import { env } from '../../config/env';
import { ApiError } from '../../lib/apiError';
import { createLogger } from '../../config/logger';
import { sendEmail, buildVerificationEmailHtml, buildPasswordResetEmailHtml } from '../notifications/email.service';
import { trackEvent } from '../analytics/analytics.service';

const log = createLogger('auth-service');

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Ensures a `public.users` profile row and a default workspace exist for a
 * given Supabase Auth identity. Called after both password signup and the
 * first-ever OAuth login for a given identity — a user should never exist
 * without a profile and a workspace, regardless of how they signed up.
 */
async function ensureProfileAndWorkspace(authUserId: string, email: string, displayName?: string) {
  const { data: existing } = await supabaseAdmin().from('users').select('id').eq('id', authUserId).maybeSingle();
  if (existing) return;

  const { data: workspace, error: wsError } = await supabaseAdmin()
    .from('workspaces')
    .insert({ name: displayName ? `${displayName}'s Workspace` : 'My Workspace' })
    .select('id')
    .single();
  if (wsError || !workspace) throw ApiError.internal('Failed to create default workspace.');

  const { error: userError } = await supabaseAdmin().from('users').insert({
    id: authUserId,
    email,
    display_name: displayName ?? null,
    current_workspace_id: workspace.id,
  });
  if (userError) throw ApiError.internal('Failed to create user profile.');

  await supabaseAdmin().from('workspaces').update({ owner_user_id: authUserId }).eq('id', workspace.id);
  await supabaseAdmin().from('workspace_members').insert({
    workspace_id: workspace.id,
    user_id: authUserId,
    role: 'owner',
    status: 'active',
    joined_at: new Date().toISOString(),
  });
}

/**
 * Sends DryRun's own verification email, independent of whatever
 * confirmation state Supabase Auth itself considers the identity to be in.
 * This is what makes verification blocking for Google OAuth signups too
 * (architecture note in middleware/authenticate.ts) — an OAuth login is
 * auto-confirmed on Supabase's side, but our own `users.email_verified_at`
 * gate is not satisfied until this link is clicked.
 */
export async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await supabaseAdmin().from('email_verification_tokens').insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  const link = `${env.frontendUrl}/verify-email?token=${token}`;
  await sendEmail({ to: email, subject: 'Confirm your DryRun email', html: buildVerificationEmailHtml(link) });
}

export async function signup(email: string, password: string, displayName?: string) {
  const { data, error } = await supabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Supabase-level confirmation is separate from our own gate — see note above
  });
  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes('already registered')) {
      throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Try logging in instead.');
    }
    throw ApiError.internal('Signup failed. Please try again.');
  }

  await ensureProfileAndWorkspace(data.user.id, email, displayName);
  await sendVerificationEmail(data.user.id, email);
  await trackEvent('signup_completed', { userId: data.user.id }, { provider: 'password' });

  return { userId: data.user.id };
}

/**
 * Called from the Google OAuth callback route after Supabase Auth has
 * linked/created the identity. If this is the very first login for this
 * identity, creates the profile/workspace and sends our own verification
 * email — the user is fully authenticated with Supabase at this point but
 * will be blocked by the `authenticate` middleware's EMAIL_NOT_VERIFIED
 * check until they click that link.
 */
export async function handleOAuthLogin(authUserId: string, email: string, displayName?: string) {
  const { data: existing } = await supabaseAdmin()
    .from('users')
    .select('id, email_verified_at')
    .eq('id', authUserId)
    .maybeSingle();

  if (!existing) {
    await ensureProfileAndWorkspace(authUserId, email, displayName);
    await sendVerificationEmail(authUserId, email);
    await trackEvent('signup_completed', { userId: authUserId }, { provider: 'google' });
  }
}

export async function verifyEmail(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  const { data: row } = await supabaseAdmin()
    .from('email_verification_tokens')
    .select('id, user_id, expires_at, consumed_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!row || row.consumed_at || new Date(row.expires_at).getTime() < Date.now()) {
    throw ApiError.badRequest('This verification link is invalid or has expired. Request a new one.');
  }

  await supabaseAdmin()
    .from('users')
    .update({ email_verified_at: new Date().toISOString() })
    .eq('id', row.user_id);

  await supabaseAdmin()
    .from('email_verification_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id);

  log.info({ userId: row.user_id }, 'Email verified');
}

export async function resendVerification(userId: string, email: string): Promise<void> {
  // Invalidate any outstanding tokens for this user before issuing a new one —
  // avoids a pile-up of valid tokens for the same account.
  await supabaseAdmin()
    .from('email_verification_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('consumed_at', null);

  await sendVerificationEmail(userId, email);
}

export async function forgotPassword(email: string): Promise<void> {
  // Always resolve successfully regardless of whether the email exists —
  // no account enumeration via response timing/shape.
  const { data } = await supabaseAdmin().auth.admin.listUsers();
  const user = data.users.find((u) => u.email === email);
  if (!user) return;

  const token = generateToken();
  await supabaseAdmin().from('password_reset_tokens').insert({
    user_id: user.id,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  const link = `${env.frontendUrl}/reset-password?token=${token}`;
  await sendEmail({ to: email, subject: 'Reset your DryRun password', html: buildPasswordResetEmailHtml(link) });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(token);
  const { data: row } = await supabaseAdmin()
    .from('password_reset_tokens')
    .select('id, user_id, expires_at, consumed_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!row || row.consumed_at || new Date(row.expires_at).getTime() < Date.now()) {
    throw ApiError.badRequest('This reset link is invalid or has expired.');
  }

  const { error } = await supabaseAdmin().auth.admin.updateUserById(row.user_id, { password: newPassword });
  if (error) throw ApiError.internal('Failed to reset password.');

  await supabaseAdmin()
    .from('password_reset_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id);
}

/** "Sign out of all sessions" — revokes the entire refresh-token family, not just the current client's token. */
export async function logoutAllSessions(userId: string): Promise<void> {
  const { error } = await supabaseAdmin().auth.admin.signOut(userId, 'global');
  if (error) {
    log.warn({ err: error, userId }, 'Failed to revoke all sessions');
    throw ApiError.internal('Failed to sign out of all sessions.');
  }
}
