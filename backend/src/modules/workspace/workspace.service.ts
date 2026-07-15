import { randomBytes, createHash } from 'crypto';
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { env } from '../../config/env';
import { sendEmail, buildWorkspaceInviteEmailHtml } from '../notifications/email.service';
import { invalidateWorkspaceContextCache } from '../../middleware/resolveWorkspace';
import { trackEvent } from '../analytics/analytics.service';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function getCurrentWorkspace(workspaceId: string) {
  const { data, error } = await supabaseAdmin().from('workspaces').select('*').eq('id', workspaceId).single();
  if (error || !data) throw ApiError.notFound('Workspace not found.');
  return data;
}

export async function updateWorkspace(workspaceId: string, updates: { name?: string }) {
  const { data, error } = await supabaseAdmin()
    .from('workspaces')
    .update(updates)
    .eq('id', workspaceId)
    .select('*')
    .single();
  if (error) throw ApiError.internal('Failed to update workspace.');
  return data;
}

export async function listMembers(workspaceId: string) {
  const { data, error } = await supabaseAdmin()
    .from('workspace_members')
    .select('id, user_id, role, status, joined_at, users(email, display_name)')
    .eq('workspace_id', workspaceId)
    .neq('status', 'removed');
  if (error) throw ApiError.internal('Failed to list members.');
  return data;
}

/**
 * Aggregate-only team progress — deliberately backed by a separate query
 * path that never selects raw session_messages/session_debriefs content.
 * This is what makes the privacy visibility matrix (architecture doc §7.2,
 * §3.4) structurally enforced rather than just a convention: there is no
 * code path here that could accidentally leak a member's transcript,
 * because this function never queries that table at all.
 */
export async function getAggregateTeamProgress(workspaceId: string) {
  const { data, error } = await supabaseAdmin()
    .from('user_skill_trend')
    .select('user_id, composite_avg, period_start, period_end')
    .eq('workspace_id', workspaceId)
    .order('period_start', { ascending: false })
    .limit(50);
  if (error) throw ApiError.internal('Failed to load team progress.');

  const byUser = new Map<string, number[]>();
  for (const row of data ?? []) {
    const arr = byUser.get(row.user_id) ?? [];
    arr.push(row.composite_avg);
    byUser.set(row.user_id, arr);
  }
  const teamAverage =
    data && data.length > 0 ? data.reduce((s, r) => s + r.composite_avg, 0) / data.length : null;

  return { teamAverage, memberCount: byUser.size };
}

export async function createInvite(
  workspaceId: string,
  invitedByUserId: string,
  email: string,
  role: 'admin' | 'member'
) {
  const token = randomBytes(24).toString('base64url');
  const { data: invite, error } = await supabaseAdmin()
    .from('workspace_invites')
    .insert({
      workspace_id: workspaceId,
      email,
      role,
      token_hash: hashToken(token),
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      invited_by: invitedByUserId,
    })
    .select('id')
    .single();
  if (error || !invite) throw ApiError.internal('Failed to create invite.');

  const { data: workspace } = await supabaseAdmin().from('workspaces').select('name').eq('id', workspaceId).single();
  const { data: inviter } = await supabaseAdmin().from('users').select('display_name').eq('id', invitedByUserId).single();

  const link = `${env.frontendUrl}/invites/accept?token=${token}`;
  await sendEmail({
    to: email,
    subject: `You've been invited to join ${workspace?.name ?? 'a DryRun workspace'}`,
    html: buildWorkspaceInviteEmailHtml(workspace?.name ?? 'DryRun', inviter?.display_name ?? 'A teammate', link),
  });

  await trackEvent('workspace_member_invited', { workspaceId }, { role });
  return invite;
}

export async function acceptInvite(token: string, userId: string) {
  const tokenHash = hashToken(token);
  const { data: invite, error } = await supabaseAdmin()
    .from('workspace_invites')
    .select('id, workspace_id, role, status, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!invite || error || invite.status !== 'pending' || new Date(invite.expires_at).getTime() < Date.now()) {
    throw ApiError.badRequest('This invite is invalid or has expired.');
  }

  await supabaseAdmin().from('workspace_members').insert({
    workspace_id: invite.workspace_id,
    user_id: userId,
    role: invite.role,
    status: 'active',
    joined_at: new Date().toISOString(),
  });

  await supabaseAdmin().from('workspace_invites').update({ status: 'accepted' }).eq('id', invite.id);
  await trackEvent('workspace_member_joined', { workspaceId: invite.workspace_id, userId }, {});

  return { workspaceId: invite.workspace_id };
}

export async function removeMember(workspaceId: string, memberUserId: string, actorUserId: string) {
  await supabaseAdmin()
    .from('workspace_members')
    .update({ status: 'removed' })
    .eq('workspace_id', workspaceId)
    .eq('user_id', memberUserId);

  await invalidateWorkspaceContextCache(memberUserId, workspaceId);
  await supabaseAdmin().from('audit_log').insert({
    actor_user_id: actorUserId,
    workspace_id: workspaceId,
    action: 'member_removed',
    target_type: 'workspace_member',
    target_id: memberUserId,
    metadata: {},
  });
}

export async function updateMemberRole(
  workspaceId: string,
  memberUserId: string,
  newRole: 'admin' | 'member',
  actorUserId: string
) {
  await supabaseAdmin()
    .from('workspace_members')
    .update({ role: newRole })
    .eq('workspace_id', workspaceId)
    .eq('user_id', memberUserId);

  await invalidateWorkspaceContextCache(memberUserId, workspaceId);
  await supabaseAdmin().from('audit_log').insert({
    actor_user_id: actorUserId,
    workspace_id: workspaceId,
    action: 'role_changed',
    target_type: 'workspace_member',
    target_id: memberUserId,
    metadata: { newRole },
  });
}

export async function transferOwnership(workspaceId: string, newOwnerUserId: string, currentOwnerUserId: string) {
  await supabaseAdmin().from('workspaces').update({ owner_user_id: newOwnerUserId }).eq('id', workspaceId);
  await supabaseAdmin()
    .from('workspace_members')
    .update({ role: 'owner' })
    .eq('workspace_id', workspaceId)
    .eq('user_id', newOwnerUserId);
  await supabaseAdmin()
    .from('workspace_members')
    .update({ role: 'admin' })
    .eq('workspace_id', workspaceId)
    .eq('user_id', currentOwnerUserId);

  await invalidateWorkspaceContextCache(newOwnerUserId, workspaceId);
  await invalidateWorkspaceContextCache(currentOwnerUserId, workspaceId);
  await supabaseAdmin().from('audit_log').insert({
    actor_user_id: currentOwnerUserId,
    workspace_id: workspaceId,
    action: 'ownership_transferred',
    target_type: 'workspace',
    target_id: workspaceId,
    metadata: { newOwnerUserId },
  });
}
