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

/**
 * FIX: the workspace_members insert's error was never checked. If the
 * user is already an active member of this workspace (re-invited while a
 * stale invite link still existed, or the invite was accepted twice),
 * the insert fails against the (workspace_id, user_id) unique constraint
 * — but the code proceeded anyway, marking the invite 'accepted' and
 * firing a workspace_member_joined analytics event even though no
 * membership row was actually created. Now checks the insert's result
 * and gives a clear, correct response for the already-a-member case
 * rather than reporting success for something that didn't happen.
 */
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

  const { data: existingMembership } = await supabaseAdmin()
    .from('workspace_members')
    .select('id, status')
    .eq('workspace_id', invite.workspace_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingMembership?.status === 'active') {
    // Already a member — mark this stale invite accepted so it can't be
    // reused, but don't pretend a fresh join just happened.
    await supabaseAdmin().from('workspace_invites').update({ status: 'accepted' }).eq('id', invite.id);
    return { workspaceId: invite.workspace_id, alreadyMember: true };
  }

  if (existingMembership) {
    // A 'removed' membership row already exists for this (workspace, user)
    // pair — the unique constraint means we must update it back to active
    // rather than insert a second row for the same pair.
    const { error: updateError } = await supabaseAdmin()
      .from('workspace_members')
      .update({ role: invite.role, status: 'active', joined_at: new Date().toISOString() })
      .eq('id', existingMembership.id);
    if (updateError) throw ApiError.internal('Failed to accept invite.');
  } else {
    const { error: insertError } = await supabaseAdmin().from('workspace_members').insert({
      workspace_id: invite.workspace_id,
      user_id: userId,
      role: invite.role,
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    if (insertError) throw ApiError.internal('Failed to accept invite.');
  }

  await supabaseAdmin().from('workspace_invites').update({ status: 'accepted' }).eq('id', invite.id);
  await trackEvent('workspace_member_joined', { workspaceId: invite.workspace_id, userId }, {});

  return { workspaceId: invite.workspace_id, alreadyMember: false };
}

/**
 * FIX: the update's result was previously never checked, meaning a
 * memberUserId that isn't actually an active member of this workspace
 * (typo, stale client state, or a member already removed) would silently
 * match zero rows while an audit_log entry claiming 'member_removed'
 * still got written unconditionally — a false record in exactly the
 * table that exists to be a trustworthy account of what happened.
 */
export async function removeMember(workspaceId: string, memberUserId: string, actorUserId: string) {
  const { data, error } = await supabaseAdmin()
    .from('workspace_members')
    .update({ status: 'removed' })
    .eq('workspace_id', workspaceId)
    .eq('user_id', memberUserId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle();

  if (error || !data) {
    throw ApiError.notFound('This user is not an active member of this workspace.');
  }

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

/** Same fix as removeMember above: verify the update actually matched an active member before recording the audit entry. */
export async function updateMemberRole(
  workspaceId: string,
  memberUserId: string,
  newRole: 'admin' | 'member',
  actorUserId: string
) {
  const { data, error } = await supabaseAdmin()
    .from('workspace_members')
    .update({ role: newRole })
    .eq('workspace_id', workspaceId)
    .eq('user_id', memberUserId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle();

  if (error || !data) {
    throw ApiError.notFound('This user is not an active member of this workspace.');
  }

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

/**
 * SECURITY/INTEGRITY FIX: this used to write workspaces.owner_user_id
 * unconditionally, with no check that newOwnerUserId is actually an
 * active member of this workspace. requireRole('owner') at the route
 * only verifies the CALLER's role — it says nothing about the TARGET
 * user. Without this check, a typo'd or malicious newOwnerUserId would
 * still succeed on the first write (workspaces.owner_user_id now points
 * to a non-member), while the second write (promoting that user's
 * workspace_members row to 'owner') would silently match zero rows since
 * they have no membership row in this workspace at all — leaving the
 * workspace with an owner_user_id pointing to a non-member AND no row
 * anywhere holding the 'owner' role, since the real owner was already
 * demoted to 'admin' by the third write. A genuinely corrupted, hard-to-
 * recover ownership record, not just an authorization gap.
 */
export async function transferOwnership(workspaceId: string, newOwnerUserId: string, currentOwnerUserId: string) {
  const { data: targetMembership } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', newOwnerUserId)
    .eq('status', 'active')
    .maybeSingle();

  if (!targetMembership) {
    throw ApiError.badRequest('The new owner must be an active member of this workspace.');
  }

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
