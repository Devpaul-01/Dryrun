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

// Postgres unique_violation SQLSTATE — see the FIX comment below for why
// this specific code gets treated as an expected outcome here.
const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Ensures a `public.users` profile row and a default workspace exist for a
 * given Supabase Auth identity. Called after both password signup and the
 * first-ever OAuth login for a given identity — a user should never exist
 * without a profile and a workspace, regardless of how they signed up.
 *
 * FIX (backend-takeover audit, Task #16 — mobile-readiness review): the
 * check-then-insert above (`if (existing) return`) is not atomic. Two
 * concurrent calls for the same brand-new identity — which becomes a
 * realistic scenario once `authenticate` (below) can trigger this path on
 * ANY request from a not-yet-provisioned user, not just the single
 * dedicated signup/OAuth-callback call site, since a mobile client
 * commonly fires several API calls in parallel right after login — both
 * pass the `existing` check, both create their OWN workspace row, and
 * only one wins the `users` insert (its id is the table's primary key).
 * Reproduced directly against Postgres: the losing call's `users` insert
 * correctly fails with a unique-violation, but its workspace insert had
 * already committed, leaving a permanently orphaned, ownerless,
 * zero-member workspace row behind — nothing ever cleans these up.
 *
 * Fixed two ways: (1) the `users` insert's error is now inspected
 * explicitly — a unique-violation (23505) means a concurrent call already
 * won and fully provisioned this identity, which is the expected,
 * harmless outcome under a race, not a real failure, so this call cleans
 * up the workspace IT created (which is now redundant) and returns
 * normally instead of throwing; (2) any other insert error still throws
 * ApiError.internal as before, since that's a genuine failure.
 *
 * Returns whether THIS call actually performed the provisioning (true)
 * versus finding it already done, either before starting or by losing a
 * concurrent race (false) — callers that follow up with a side effect
 * that must happen exactly once per identity (handleOAuthLogin's
 * verification email + signup-event tracking, below) gate on this return
 * value instead of their own separate existence check, which is exactly
 * what made the duplicate-email race possible in the first place: two
 * concurrent handleOAuthLogin calls could both see "no row yet" on their
 * own pre-check, both correctly end up with the row provisioned exactly
 * once now that this function is race-safe, but — without this return
 * value — both would still independently decide "I must be the one who
 * needs to send the welcome email," sending it twice.
 */
async function ensureProfileAndWorkspace(authUserId: string, email: string, displayName?: string): Promise<boolean> {
  const { data: existing } = await supabaseAdmin().from('users').select('id').eq('id', authUserId).maybeSingle();
  if (existing) return false;

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
  if (userError) {
    if (userError.code === POSTGRES_UNIQUE_VIOLATION) {
      log.info({ authUserId }, 'User profile already provisioned by a concurrent call — cleaning up redundant workspace');
      await supabaseAdmin().from('workspaces').delete().eq('id', workspace.id);
      return false;
    }
    throw ApiError.internal('Failed to create user profile.');
  }

  await supabaseAdmin().from('workspaces').update({ owner_user_id: authUserId }).eq('id', workspace.id);
  await supabaseAdmin().from('workspace_members').insert({
    workspace_id: workspace.id,
    user_id: authUserId,
    role: 'owner',
    status: 'active',
    joined_at: new Date().toISOString(),
  });
  return true;
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
 *
 * Called from two places now: the dedicated /google/callback route, and
 * — FIX (backend-takeover audit, Task #16) — authenticate.ts's
 * auto-provisioning path for any OAuth identity with no existing row,
 * since nothing guarantees /google/callback runs (or finishes) before a
 * mobile client's first authenticated request. That means this function
 * can legitimately be called concurrently for the same brand-new
 * identity (a mobile client firing several API calls in parallel right
 * after login). This function's OWN pre-check (`existing` above) is not
 * atomic and was the original source of a duplicate-verification-email
 * bug under that race: two concurrent calls could both see "no row yet"
 * here and both decide to send the welcome email, even once
 * ensureProfileAndWorkspace itself was made race-safe (see that
 * function's own comment) to guarantee the row is only ever created
 * once. Fixed by gating the email-send and signup-event tracking on
 * ensureProfileAndWorkspace's return value instead — it tells the truth
 * about whether THIS call actually won the provisioning, which is the
 * only thing that should decide whether this call is also responsible
 * for the one-time side effects. The `existing` check above is now only
 * a cheap short-circuit for the overwhelmingly common case (a returning
 * user, not a race), not the source of truth.
 */
export async function handleOAuthLogin(authUserId: string, email: string, displayName?: string) {
  const { data: existing } = await supabaseAdmin()
    .from('users')
    .select('id, email_verified_at')
    .eq('id', authUserId)
    .maybeSingle();

  if (existing) return;

  const didProvision = await ensureProfileAndWorkspace(authUserId, email, displayName);
  if (didProvision) {
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

// FIX (CRIT-7): matches profile.routes.ts's GRACE_PERIOD_DAYS and
// jobs/workers/purgeSoftDeletedAccounts.worker.ts's own GRACE_PERIOD_DAYS
// constant — the recoverable window and the hard-purge window must agree,
// since this function is what actually makes "you have 14 days to
// recover it" true.
const RECOVERY_GRACE_PERIOD_DAYS = 14;

/**
 * Self-service account recovery for a soft-deleted user within the grace
 * period. Deliberately does NOT go through the normal Supabase session
 * flow via the `authenticate` middleware — that middleware unconditionally
 * rejects any request from a user with `deleted_at` set (see
 * authenticate.ts), which is exactly the state a recoverable account is
 * in. This function is the one legitimate place in the app that
 * authenticates a soft-deleted user directly: it verifies real
 * credentials via Supabase itself, then clears deleted_at only after
 * confirming both the credentials and the grace window are valid.
 */
export async function recoverAccount(email: string, password: string) {
  const { data, error } = await supabaseAdmin().auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    throw ApiError.unauthorized('Invalid email or password.');
  }

  const { data: profile, error: profileError } = await supabaseAdmin()
    .from('users')
    .select('id, deleted_at')
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) {
    throw ApiError.notFound('Account not found. Please contact support.');
  }

  if (!profile.deleted_at) {
    // Not actually deleted — the caller already proved valid credentials,
    // so just return a normal session rather than erroring on "nothing to
    // recover."
    return { session: data.session };
  }

  const deletedAtMs = new Date(profile.deleted_at).getTime();
  const graceExpiresAtMs = deletedAtMs + RECOVERY_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  if (Date.now() >= graceExpiresAtMs) {
    throw ApiError.badRequest('This account is no longer recoverable. Please contact support or create a new account.');
  }

  const { error: updateError } = await supabaseAdmin().from('users').update({ deleted_at: null }).eq('id', profile.id);
  if (updateError) throw ApiError.internal('Failed to recover account. Please try again.');

  await supabaseAdmin().from('audit_log').insert({
    actor_user_id: profile.id,
    action: 'account_recovered',
    target_type: 'user',
    target_id: profile.id,
    metadata: {},
  });

  log.info({ userId: profile.id }, 'Account recovered from soft-delete');
  return { session: data.session };
}
