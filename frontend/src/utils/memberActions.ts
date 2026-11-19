import type { WorkspaceRole } from '@/types/api';

export type MemberAction = 'make_admin' | 'make_member' | 'transfer' | 'remove';

/**
 * Which management actions the viewer may offer for a member row, mirroring the
 * backend gates: remove = owner|admin (never the owner, never yourself — use
 * Leave); role change and transfer = owner only, and never on the owner.
 */
export function memberActions(viewerRole: WorkspaceRole | null, viewerUserId: string | undefined, member: { user_id: string; role: WorkspaceRole }): MemberAction[] {
  if (!viewerRole || viewerRole === 'member') return [];
  if (member.user_id === viewerUserId || member.role === 'owner') return [];
  const actions: MemberAction[] = [];
  if (viewerRole === 'owner') {
    actions.push(member.role === 'admin' ? 'make_member' : 'make_admin', 'transfer');
  }
  actions.push('remove');
  return actions;
}
