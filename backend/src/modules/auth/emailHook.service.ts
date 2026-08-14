import { Webhook } from 'standardwebhooks';
import { env } from '../../config/env';
import { createLogger } from '../../config/logger';
import { ApiError } from '../../lib/apiError';
import {
  sendEmail,
  buildVerificationEmailHtml,
  buildPasswordResetEmailHtml,
} from '../notifications/email.service';

const log = createLogger('email-hook-service');

/**
 * Handles Supabase's "Send Email" Auth Hook — registered in the Supabase
 * dashboard under Authentication > Hooks > Send Email (type: HTTPS,
 * pointed at POST /api/v1/auth/email-hook). Whenever a genuine Supabase
 * Auth flow needs to send an email (resetPasswordForEmail, resend,
 * signInWithOtp, invite — anything EXCEPT admin.createUser/generateLink,
 * which never trigger this hook regardless — see auth.service.ts's header
 * comment for why signup confirmation uses a different mechanism),
 * Supabase POSTs a signed payload here instead of sending the email
 * itself. This handler verifies that signature, then sends the actual
 * email via the same email.service.ts used everywhere else in the app.
 *
 * VERIFICATION: Supabase signs the payload using the Standard Webhooks
 * spec (the same spec/library Anthropic, OpenAI, and others use for their
 * own webhooks) — verified here via the `standardwebhooks` npm package,
 * exactly as Supabase's own documentation examples do (their examples are
 * written for Deno/Edge Functions, but the library and verification
 * mechanics are identical in Node.js).
 *
 * OUTPUT CONTRACT: per Supabase's docs, no response body is required — an
 * empty 200 means success. A non-2xx tells Supabase the send failed
 * (Supabase does not retry automatically for this hook, unlike its
 * webhook/database-webhook products, so a failure here means the user
 * simply doesn't get the email — logged loudly for that reason).
 */

interface SendEmailHookUser {
  email: string;
  new_email?: string;
}

interface SendEmailHookEmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new: string;
  token_hash_new: string;
  old_email?: string;
}

interface SendEmailHookPayload {
  user: SendEmailHookUser;
  email_data: SendEmailHookEmailData;
}

/**
 * Verifies the raw request body against Supabase's signature. `rawBody`
 * MUST be the exact, unparsed request body string/Buffer — signature
 * verification fails if the body was re-serialized after JSON.parse,
 * which is why the route registers this endpoint with a raw-body parser
 * ahead of the global `express.json()` middleware (see auth.routes.ts).
 */
export function verifyAndParseEmailHookPayload(rawBody: string | Buffer, headers: Record<string, string>): SendEmailHookPayload {
  if (!env.supabase.sendEmailHookSecret) {
    log.error('Received a Send Email Hook request but SUPABASE_SEND_EMAIL_HOOK_SECRET is not configured');
    throw ApiError.internal('Email hook is not configured on this server.');
  }

  // Supabase's secret is formatted "v1,whsec_<base64>" in the dashboard;
  // the Webhook constructor wants only the base64 portion, matching every
  // official Supabase example (Deno and otherwise).
  const secret = env.supabase.sendEmailHookSecret.replace('v1,whsec_', '');
  const wh = new Webhook(secret);

  try {
    const verified = wh.verify(rawBody, headers) as SendEmailHookPayload;
    return verified;
  } catch (err) {
    log.warn({ err }, 'Send Email Hook signature verification failed — rejecting');
    throw ApiError.unauthorized('Invalid webhook signature.');
  }
}

/**
 * Dispatches the verified payload to the right email template/recipient.
 * Only the action types this product's current auth flows can actually
 * trigger are handled with a dedicated template (signup-adjacent —
 * though see auth.service.ts, signup itself never reaches this hook —
 * recovery, and email_change); anything else gets a generic fallback so
 * an unexpected-but-legitimate Supabase event still results in SOME email
 * reaching the user rather than silently doing nothing.
 */
export async function handleEmailHookPayload(payload: SendEmailHookPayload): Promise<void> {
  const { user, email_data } = payload;

  switch (email_data.email_action_type) {
    case 'recovery': {
      const link = `${env.frontendUrl}/reset-password?token=${encodeURIComponent(email_data.token_hash)}`;
      await sendEmail({
        to: user.email,
        subject: 'Reset your DryRun password',
        html: buildPasswordResetEmailHtml(link),
      });
      return;
    }

    case 'signup':
    case 'email': {
      // Reachable only if some future flow calls a genuine Supabase
      // signUp()/resend() path rather than admin.createUser()+
      // generateLink() (auth.service.ts's current signup/resend
      // mechanism bypasses this hook entirely, by necessity — see that
      // file's header comment). Handled here defensively so the hook
      // doesn't silently drop the email if that ever changes.
      const link = `${env.frontendUrl}/verify-email?token=${encodeURIComponent(email_data.token_hash)}`;
      await sendEmail({
        to: user.email,
        subject: 'Confirm your DryRun email',
        html: buildVerificationEmailHtml(link),
      });
      return;
    }

    case 'email_change': {
      // Token/hash field naming is reversed by Supabase for backward
      // compatibility — see this file's header and Supabase's own docs.
      // token_hash_new pairs with the CURRENT email; token_hash pairs
      // with the NEW email. Not currently exposed by this product's UI,
      // handled correctly regardless so enabling it later needs no
      // changes here.
      if (email_data.token_hash_new) {
        const currentEmailLink = `${env.frontendUrl}/confirm-email-change?token=${encodeURIComponent(email_data.token_hash_new)}`;
        await sendEmail({
          to: user.email,
          subject: 'Confirm your DryRun email change',
          html: `<p>Confirm this email change from your current address:</p><p><a href="${currentEmailLink}">${currentEmailLink}</a></p>`,
        });
      }
      if (user.new_email && email_data.token_hash) {
        const newEmailLink = `${env.frontendUrl}/confirm-email-change?token=${encodeURIComponent(email_data.token_hash)}`;
        await sendEmail({
          to: user.new_email,
          subject: 'Confirm your new DryRun email address',
          html: `<p>Confirm this as your new email address:</p><p><a href="${newEmailLink}">${newEmailLink}</a></p>`,
        });
      }
      return;
    }

    default: {
      log.info({ actionType: email_data.email_action_type }, 'Unhandled Supabase email action type — sending generic fallback');
      const link = `${env.frontendUrl}?token=${encodeURIComponent(email_data.token_hash)}`;
      await sendEmail({
        to: user.email,
        subject: 'Action required for your DryRun account',
        html: `<p>Follow this link to continue:</p><p><a href="${link}">${link}</a></p>`,
      });
    }
  }
}
