import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  displayName: z.string().min(1).max(120).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const resendVerificationSchema = z.object({}).optional();

/**
 * FIX (CRIT-7): the account-deletion response has always told the user
 * they can "recover it by logging back in" within 14 days, but no such
 * flow existed — authenticate.ts unconditionally blocks any request from
 * a user with deleted_at set, so a soft-deleted user had no way to log
 * back in through the normal /login route at all. This is the schema for
 * the dedicated recovery endpoint that makes that promise real (see
 * auth.service.ts#recoverAccount and auth.routes.ts's new route).
 */
export const recoverAccountSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
