import { z } from 'zod';

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
});

export const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

export const transferOwnershipSchema = z.object({
  newOwnerUserId: z.string().uuid(),
});
