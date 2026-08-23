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

export const switchWorkspaceSchema = z.object({
  workspace_id: z.string().uuid(),
});

/**
 * Added alongside seat removal (HIGH-2): GET /current/members moves from
 * a flat, hard-capped-at-500 list to real cursor pagination, since the
 * old cap's justification ("seat-based billing already caps membership
 * economically") no longer holds once seats are removed.
 */
export const listMembersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});
