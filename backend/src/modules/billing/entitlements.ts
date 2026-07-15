import { supabaseAdmin } from '../../config/supabase';
import { isPaymentEnforcementEnabled } from '../../config/systemConfig';
import { trackEvent } from '../analytics/analytics.service';
import { ResolvedWorkspace } from '../../middleware/resolveWorkspace';

export interface EntitlementResult {
  allowed: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

const GRACE_STATUSES = new Set(['active', 'past_due']); // past_due only within grace window, checked below

interface SubscriptionRow {
  status: string;
  current_period_end: string;
  plan_id: string;
  created_at: string;
}

const PAST_DUE_GRACE_DAYS = 10;

/**
 * Resolves the workspace's effective plan, applying the grace-period
 * allowance: `active` and `past_due`-within-grace both count as entitled;
 * `canceled` and `past_due`-beyond-grace fall back to the free plan's limits.
 * This is deliberately not a naive `status === 'active'` check — a transient
 * payment hiccup should not immediately punish a paying customer.
 */
async function resolveEffectivePlan(workspaceId: string) {
  const { data: sub } = await supabaseAdmin()
    .from('subscriptions')
    .select('status, current_period_end, plan_id, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionRow>();

  if (!sub) {
    return getFreePlan();
  }

  if (sub.status === 'active') {
    return getPlanById(sub.plan_id);
  }

  if (sub.status === 'past_due') {
    const periodEnd = new Date(sub.current_period_end).getTime();
    const graceExpiresAt = periodEnd + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() < graceExpiresAt) {
      return getPlanById(sub.plan_id); // still entitled during grace
    }
  }

  return getFreePlan();
}

async function getPlanById(planId: string) {
  const { data } = await supabaseAdmin().from('plans').select('*').eq('id', planId).single();
  return data;
}

async function getFreePlan() {
  const { data } = await supabaseAdmin().from('plans').select('*').eq('key', 'free').single();
  return data;
}

/**
 * Shared wrapper implementing the pattern every entitlement function
 * follows: check the global enforcement flag first; if disabled, allow
 * unconditionally and log a `feature_gate_bypassed` event so there's real
 * usage data to decide when to flip enforcement on.
 */
async function withEnforcementCheck(
  gate: string,
  workspace: ResolvedWorkspace,
  check: () => Promise<EntitlementResult>
): Promise<EntitlementResult> {
  const enforcementEnabled = await isPaymentEnforcementEnabled();
  if (!enforcementEnabled) {
    await trackEvent('feature_gate_bypassed', { workspaceId: workspace.id }, { gate });
    return { allowed: true };
  }
  const result = await check();
  if (!result.allowed) {
    await trackEvent('feature_gate_hit', { workspaceId: workspace.id }, { gate, ...result.details });
  }
  return result;
}

export async function canStartSession(workspace: ResolvedWorkspace): Promise<EntitlementResult> {
  return withEnforcementCheck('session_limit', workspace, async () => {
    const plan = await resolveEffectivePlan(workspace.id);
    if (!plan || plan.session_limit_per_month == null) return { allowed: true };

    const periodStart = new Date();
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);

    const { count } = await supabaseAdmin()
      .from('practice_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)
      .gte('created_at', periodStart.toISOString());

    if ((count ?? 0) < plan.session_limit_per_month) return { allowed: true };
    return {
      allowed: false,
      reason: 'SESSION_LIMIT_REACHED',
      details: { plan: plan.key, limit: plan.session_limit_per_month },
    };
  });
}

export async function canGeneratePersonaFromDocument(workspace: ResolvedWorkspace): Promise<EntitlementResult> {
  return withEnforcementCheck('persona_from_document', workspace, async () => {
    const plan = await resolveEffectivePlan(workspace.id);
    const features = (plan?.features as Record<string, unknown>) ?? {};
    if (features.persona_from_document === true) return { allowed: true };
    return { allowed: false, reason: 'PERSONA_FROM_DOCUMENT_NOT_INCLUDED', details: { plan: plan?.key } };
  });
}

export async function canGeneratePlaybook(workspace: ResolvedWorkspace): Promise<EntitlementResult> {
  return withEnforcementCheck('playbook_limit', workspace, async () => {
    const plan = await resolveEffectivePlan(workspace.id);
    const features = (plan?.features as Record<string, unknown>) ?? {};
    const limit = features.playbook_limit as number | null | undefined;
    if (limit == null) return { allowed: true }; // unlimited

    const { count } = await supabaseAdmin()
      .from('playbooks')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id);

    if ((count ?? 0) < limit) return { allowed: true };
    return { allowed: false, reason: 'PLAYBOOK_LIMIT_REACHED', details: { plan: plan?.key, limit } };
  });
}

export async function canInviteMember(workspace: ResolvedWorkspace): Promise<EntitlementResult> {
  return withEnforcementCheck('seat_limit', workspace, async () => {
    const { data: ws } = await supabaseAdmin()
      .from('workspaces')
      .select('seats_purchased')
      .eq('id', workspace.id)
      .single();

    const { count } = await supabaseAdmin()
      .from('workspace_members')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)
      .eq('status', 'active');

    const { count: pendingInvites } = await supabaseAdmin()
      .from('workspace_invites')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)
      .eq('status', 'pending');

    const seatsUsed = (count ?? 0) + (pendingInvites ?? 0);
    const seatsPurchased = ws?.seats_purchased ?? 1;

    if (seatsUsed < seatsPurchased) return { allowed: true };
    return { allowed: false, reason: 'SEAT_LIMIT_REACHED', details: { seatsPurchased } };
  });
}

/**
 * Reserved for Phase 2 (voice mode). Implemented now so shipping voice later
 * is a plan-data/config change, not new plumbing.
 */
export async function canUseVoiceMode(workspace: ResolvedWorkspace): Promise<EntitlementResult> {
  return withEnforcementCheck('voice_mode', workspace, async () => {
    const plan = await resolveEffectivePlan(workspace.id);
    const features = (plan?.features as Record<string, unknown>) ?? {};
    if (features.voice_mode === true) return { allowed: true };
    return { allowed: false, reason: 'VOICE_MODE_NOT_INCLUDED', details: { plan: plan?.key } };
  });
}
