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
  return `<p>${inviterName} invited you to join <strong>${workspaceName}</strong> on DryRun.</p>
<p><a href="${link}">${link}</a></p>
<p>This invite expires in 7 days.</p>`;
}

export function buildPaymentFailedEmailHtml(link: string): string {
  return `<p>We couldn't process your DryRun subscription renewal. Please update your payment method to keep your access.</p>
<p><a href="${link}">${link}</a></p>`;
}
