import nodemailer from 'nodemailer';
import { env } from '../../config/env';
import { createLogger } from '../../config/logger';

const log = createLogger('email-service');

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

/**
 * Provider-agnostic transactional email. Defaults to console output in
 * local dev (EMAIL_PROVIDER=console) so nothing ever silently fails to
 * "send" during development — the link is printed to the log instead.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (env.email.provider === 'smtp') {
    const transporter = nodemailer.createTransport({
      host: env.email.smtp.host,
      port: env.email.smtp.port,
      secure: env.email.smtp.port === 465,
      auth: { user: env.email.smtp.user, pass: env.email.smtp.pass },
    });
    await transporter.sendMail({ from: env.email.from, ...input });
    return;
  }

  if (env.email.provider === 'resend') {
    const { Resend } = await import('resend');
    const resend = new Resend(env.email.resendApiKey);
    await resend.emails.send({ from: env.email.from, ...input });
    return;
  }

  log.info({ to: input.to, subject: input.subject }, `[console email] ${input.html.slice(0, 400)}`);
}

/**
 * FIX (backend-takeover audit, Task #15): no HTML-escaping existed
 * anywhere in the email-building layer. buildWorkspaceInviteEmailHtml
 * interpolated workspaceName and inviterName — both directly
 * user-controlled (profile.routes.ts: display_name up to 120 chars;
 * workspace.schemas.ts: name up to 200 chars, length-bounded but never
 * HTML-escaped) — straight into the email's <strong>/body text with no
 * escaping at all. Verified directly: setting a display name to
 * `<a href="https://phishing.example/login">Click here to verify your
 * DryRun account</a>` and sending a workspace invite produces exactly
 * that clickable phishing link, styled as ordinary invite text, in a
 * real transactional email sent from DryRun's own address to the
 * invitee — a stored HTML-injection vulnerability reachable by any
 * authenticated user against anyone they invite, no admin privilege or
 * special access needed. A workspace name containing an <img onerror=...>
 * payload was verified the same way.
 *
 * Fixed by escaping every interpolated value that didn't already go
 * through `link` (hrefs built from our own app URLs, not user input, so
 * intentionally left unescaped — escaping `&` in a URL query string
 * would corrupt it). Applied here and to buildWeeklySummaryEmailHtml in
 * sendWeeklySummary.worker.ts, which had the same gap for AI-generated
 * debrief/curriculum text.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildVerificationEmailHtml(link: string): string {
  return `<p>Welcome to DryRun. Confirm your email to get started:</p>
<p><a href="${link}">${link}</a></p>
<p>This link expires in 24 hours.</p>`;
}

export function buildPasswordResetEmailHtml(link: string): string {
  return `<p>Reset your DryRun password:</p>
<p><a href="${link}">${link}</a></p>
<p>If you didn't request this, you can safely ignore this email. This link expires in 1 hour.</p>`;
}

export function buildWorkspaceInviteEmailHtml(workspaceName: string, inviterName: string, link: string): string {
  return `<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(workspaceName)}</strong> on DryRun.</p>
<p><a href="${link}">${link}</a></p>
<p>This invite expires in 7 days.</p>`;
}

export function buildPaymentFailedEmailHtml(link: string): string {
  return `<p>We couldn't process your DryRun subscription renewal. Please update your payment method to keep your access.</p>
<p><a href="${link}">${link}</a></p>`;
}
