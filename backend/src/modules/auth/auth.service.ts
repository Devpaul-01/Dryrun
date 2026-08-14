import { supabaseAdmin } from '../../config/supabase';
import { env } from '../../config/env';
import { ApiError } from '../../lib/apiError';
import { createLogger } from '../../config/logger';
import { trackEvent } from '../analytics/analytics.service';

const log = createLogger('auth-service');

/**
 * SUPABASE-NATIVE EMAIL HANDLING — replaces the previous custom
 * email_verification_tokens / password_reset_tokens implementation.
 *
 * Two different Supabase mechanisms are used here, and it's worth being
 * explicit about *why* they differ, since it isn't obvious from the API
 * surface alone:
 *
 * SIGNUP CONFIRMATION uses admin.generateLink() + verifyOtp(), NOT the
 * Send Email Hook. This is because `admin.createUser()` — which this
 * backend must keep using, since it needs to control signup server-side
 * (create the profile/workspace row atomically, decide when Google OAuth
 * counts as "signed up", etc.) — is documented by Supabase to NEVER
 * trigger any email-sending path, Hook included, regardless of the
 * `email_confirm` flag. (`email_confirm` only marks the row pre-verified
 * or not; it never causes an email to be sent.) The only server-side way
 * to get a Supabase-issued, Supabase-verifiable token for a user created
 * this way is `admin.generateLink({ type: 'signup', ... })`, which
 * generates the token/link but — also by design — does not send it
 * either. So this backend still physically sends the email (via the
 * existing email.service.ts), but the token itself is entirely
 * Supabase's: generated, stored, and later validated by Supabase's own
 * `verifyOtp`, not by any custom hash/expiry logic in this codebase.
 *
 * PASSWORD RESET uses resetPasswordForEmail(), a genuine Supabase Auth
 * flow (unlike admin.createUser, this one runs through Supabase's normal
 * mailer pipeline), which means it DOES trigger the Send Email Hook once
 * that hook is registered in the Supabase dashboard (Authentication >
 * Hooks > Send Email, HTTPS type, pointed at this backend's
 * POST /api/v1/auth/email-hook — see auth.routes.ts and
 * emailHook.service.ts). Supabase generates and owns the token; this
 * backend's hook handler receives a signed callback and sends the actual
 * email, reusing the same email.service.ts templates.
 *
 * RESEND VERIFICATION reuses the same generateLink()+send pattern as
 * signup, NOT supabase.auth.resend() — `resend()` only works for users in
 * Supabase's own "pending confirmation from signUp()" state, which a
 * user created via admin.createUser() was never in.
 *
 * WHAT WAS RETIRED: email_verification_tokens and password_reset_tokens
 * tables, and every hash/expiry/consumed_at helper that used to manage
 * them here, are no longer used by this file. (Not dropped from the
 * schema in this change — see the Stage 6 write-up for the migration
 * note.)
 *
 * WHAT DID NOT CHANGE: `public.users.email_verified_at` remains the
 * source of truth the `authenticate` middleware gates on (see that file's
 * own comment on why Google OAuth users are still required to confirm
 * through this app's own gate, independent of Supabase's
 * auth.users.email_confirmed_at). This flow still sets that same column;
 * it's just populated via verifyOtp succeeding rather than a custom token
 * being matched.
 */

const VERIFY_EMAIL_REDIRECT_PATH = '/verify-email';
const RESET_PASSWORD_REDIRECT_PATH = '/reset-password';

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
 * Generates a Supabase-owned confirmation link for an existing,
 * not-yet-confirmed user, and sends it via the existing email
 * infrastructure. Used both right after signup and for resend requests —
 * both cases need the identical "generate a fresh link, send it" action,
 * which is exactly why resendVerification() calls this instead of
 * duplicating it.
 *
 * Uses generateLink's `magiclink` type, NOT `signup`. `signup` requires a
 * password and — per Supabase's own docs and confirmed by a Supabase
 * engineer in a public discussion thread — is meant to create a brand
 * new user in one step; it's the wrong shape for "generate another link
 * for a user I already created via admin.createUser()". `magiclink`
 * needs only an email, works against an existing user, and — since
 * Supabase treats `signup` and `magiclink` verification as the same
 * underlying `email` OTP type (both are deprecated in favor of a unified
 * `email` type in verifyOtp) — a magiclink-generated token is verified
 * identically to how a signup-generated one would be. The one real
 * behavioral difference is that following a magiclink also logs the user
 * in (issues a session); verifyEmail() below doesn't need or reject that
 * session, it only reads `data.user.id` to set email_verified_at, so this
 * is a safe, correct substitution for this specific purpose.
 */
async function generateAndSendVerificationEmail(email: string): Promise<void> {
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: {
      redirectTo: `${env.frontendUrl}${VERIFY_EMAIL_REDIRECT_PATH}`,
    },
  });

  if (error || !data) {
    log.error({ err: error, email }, 'Failed to generate Supabase verification link');
    throw ApiError.internal('Failed to send verification email. Please try again.');
  }

  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) {
    log.error({ email }, 'generateLink succeeded but returned no hashed_token');
    throw ApiError.internal('Failed to send verification email. Please try again.');
  }

  // This backend still sends the actual email (generateLink never does),
  // reusing the exact same transport (Resend/SMTP/console) as before —
  // only the token inside the link is Supabase's now, not a custom one.
  const link = `${env.frontendUrl}${VERIFY_EMAIL_REDIRECT_PATH}?token=${encodeURIComponent(tokenHash)}`;
  const { sendEmail, buildVerificationEmailHtml } = await import('../notifications/email.service');
  await sendEmail({ to: email, subject: 'Confirm your DryRun email', html: buildVerificationEmailHtml(link) });
}

export async function signup(email: string, password: string, displayName?: string) {
  const { data, error } = await supabaseAdmin().auth.admin.createUser({
    email,
    password,
    email_confirm: false, // Supabase-side confirmation is now real and required — no longer bypassed
  });
  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes('already registered')) {
      throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Try logging in instead.');
    }
    throw ApiError.internal('Signup failed. Please try again.');
  }

  await ensureProfileAndWorkspace(data.user.id, email, displayName);
  await generateAndSendVerificationEmail(email);
  await trackEvent('signup_completed', { userId: data.user.id }, { provider: 'password' });

  return { userId: data.user.id };
}

/**
 * Called from the Google OAuth callback route after Supabase Auth has
 * linked/created the identity. If this is the very first login for this
 * identity, creates the profile/workspace and sends our own verification
 * email — the user is fully authenticated with Supabase at this point but
 * will be blocked by the `authenticate` middleware's EMAIL_NOT_VERIFIED
 * check until they click that link. Google-confirmed identities still go
 * through this app's own gate (see authenticate.ts's comment) — that
 * product decision is unchanged by this migration, only the mechanics of
 * the confirmation email itself changed.
 */
export async function handleOAuthLogin(authUserId: string, email: string, displayName?: string) {
  const { data: existing } = await supabaseAdmin()
    .from('users')
    .select('id, email_verified_at')
    .eq('id', authUserId)
    .maybeSingle();

  if (!existing) {
    await ensureProfileAndWorkspace(authUserId, email, displayName);
    await generateAndSendVerificationEmail(email);
    await trackEvent('signup_completed', { userId: authUserId }, { provider: 'google' });
  }
}

/**
 * Verifies a signup-confirmation token_hash via Supabase's own verifyOtp
 * — Supabase validates the token's existence/expiry/single-use itself;
 * this function no longer does any of that bookkeeping. `email` and
 * `magiclink` were the two OTP types Supabase has since deprecated in
 * favor of a unified `email` type for this exact "confirm a signup" case
 * (per Supabase's current API reference).
 */
export async function verifyEmail(tokenHash: string): Promise<void> {
  const { data, error } = await supabaseAdmin().auth.verifyOtp({
    type: 'email',
    token_hash: tokenHash,
  });

  if (error || !data.user) {
    throw ApiError.badRequest('This verification link is invalid or has expired. Request a new one.');
  }

  await supabaseAdmin()
    .from('users')
    .update({ email_verified_at: new Date().toISOString() })
    .eq('id', data.user.id);

  log.info({ userId: data.user.id }, 'Email verified via Supabase verifyOtp');
}

export async function resendVerification(userId: string, email: string): Promise<void> {
  await generateAndSendVerificationEmail(email);
}

/**
 * Genuine Supabase Auth flow — routes through Supabase's own mailer
 * pipeline, meaning it DOES trigger the Send Email Hook (see this file's
 * header comment). This backend no longer generates or stores any reset
 * token itself; Supabase owns the whole token lifecycle. The hook handler
 * (emailHook.service.ts) is what actually sends the email when this fires.
 */
export async function forgotPassword(email: string): Promise<void> {
  const { error } = await supabaseAdmin().auth.resetPasswordForEmail(email, {
    redirectTo: `${env.frontendUrl}${RESET_PASSWORD_REDIRECT_PATH}`,
  });

  // Always resolve successfully regardless of whether the email exists or
  // the call errored — no account enumeration via response timing/shape,
  // same posture as before this migration.
  if (error) {
    log.warn({ err: error }, 'resetPasswordForEmail returned an error (swallowed — no account enumeration)');
  }
}

/**
 * Verifies a recovery token_hash via Supabase's verifyOtp, then updates
 * the password via the admin API. `tokenHash` here is what the frontend
 * received as `token_hash` on its reset-password redirect — see
 * emailHook.service.ts's confirmation-link construction for where that
 * value originates.
 */
export async function resetPassword(tokenHash: string, newPassword: string): Promise<void> {
  const { data, error } = await supabaseAdmin().auth.verifyOtp({
    type: 'recovery',
    token_hash: tokenHash,
  });

  if (error || !data.user) {
    throw ApiError.badRequest('This reset link is invalid or has expired.');
  }

  const { error: updateError } = await supabaseAdmin().auth.admin.updateUserById(data.user.id, { password: newPassword });
  if (updateError) throw ApiError.internal('Failed to reset password.');
}

/** "Sign out of all sessions" — revokes the entire refresh-token family, not just the current client's token. */
export async function logoutAllSessions(userId: string): Promise<void> {
  const { error } = await supabaseAdmin().auth.admin.signOut(userId, 'global');
  if (error) {
    log.warn({ err: error, userId }, 'Failed to revoke all sessions');
    throw ApiError.internal('Failed to sign out of all sessions.');
  }
}
