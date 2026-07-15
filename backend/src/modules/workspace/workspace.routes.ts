import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/requireRole';
import { entitlement } from '../../middleware/entitlement';
import { canInviteMember } from '../billing/entitlements';
import * as workspaceService from './workspace.service';
import { updateWorkspaceSchema, createInviteSchema, updateMemberRoleSchema, transferOwnershipSchema } from './workspace.schemas';
import { z } from 'zod';
import { ApiError } from '../../lib/apiError';

const router = Router();

router.get(
  '/current',
  asyncHandler(async (req, res) => {
    const workspace = await workspaceService.getCurrentWorkspace(req.workspace!.id);
    res.json({ workspace });
  })
);

router.patch(
  '/current',
  requireRole('owner', 'admin'),
  validate({ body: updateWorkspaceSchema }),
  asyncHandler(async (req, res) => {
    const workspace = await workspaceService.updateWorkspace(req.workspace!.id, req.body);
    res.json({ workspace });
  })
);

router.get(
  '/current/members',
  asyncHandler(async (req, res) => {
    const members = await workspaceService.listMembers(req.workspace!.id);
    res.json({ members });
  })
);

router.get(
  '/current/team-progress',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const progress = await workspaceService.getAggregateTeamProgress(req.workspace!.id);
    res.json({ progress });
  })
);

router.post(
  '/current/invites',
  requireRole('owner', 'admin'),
  entitlement(canInviteMember),
  validate({ body: createInviteSchema }),
  asyncHandler(async (req, res) => {
    const invite = await workspaceService.createInvite(req.workspace!.id, req.user!.id, req.body.email, req.body.role);
    res.status(201).json({ invite });
  })
);

router.post(
  '/invites/:token/accept',
  validate({ params: z.object({ token: z.string() }) }),
  asyncHandler(async (req, res) => {
    const result = await workspaceService.acceptInvite(req.params.token, req.user!.id);
    res.json({ success: true, ...result });
  })
);

router.delete(
  '/current/members/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    await workspaceService.removeMember(req.workspace!.id, req.params.id, req.user!.id);
    res.json({ success: true });
  })
);

router.patch(
  '/current/members/:id/role',
  requireRole('owner'),
  validate({ body: updateMemberRoleSchema }),
  asyncHandler(async (req, res) => {
    await workspaceService.updateMemberRole(req.workspace!.id, req.params.id, req.body.role, req.user!.id);
    res.json({ success: true });
  })
);

router.post(
  '/current/transfer-ownership',
  requireRole('owner'),
  validate({ body: transferOwnershipSchema }),
  asyncHandler(async (req, res) => {
    if (req.body.newOwnerUserId === req.user!.id) {
      throw ApiError.badRequest('You are already the owner.');
    }
    await workspaceService.transferOwnership(req.workspace!.id, req.body.newOwnerUserId, req.user!.id);
    res.json({ success: true });
  })
);

export default router;
