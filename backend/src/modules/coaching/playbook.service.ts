import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { generatePlaybookContent } from '../ai/ai.service';
import { randomBytes } from 'crypto';
import { buildSessionTranscript } from './transcript';

async function bestTranscriptFor(personaId: string | undefined, sessionId: string | undefined, workspaceId: string) {
  if (sessionId) {
    return buildSessionTranscript(sessionId);
  }

  // Fall back to the highest-scoring recent session against this persona.
  const { data: best } = await supabaseAdmin()
    .from('session_skill_scores')
    .select('session_id, composite_score, practice_sessions!inner(persona_id, workspace_id)')
    .eq('practice_sessions.persona_id', personaId)
    .eq('practice_sessions.workspace_id', workspaceId)
    .order('composite_score', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!best) throw ApiError.badRequest('No completed session found to generate a playbook from.');

  return buildSessionTranscript(best.session_id);
}

export async function generatePlaybook(input: {
  workspaceId: string;
  userId: string;
  personaId?: string;
  sessionId?: string;
  title?: string;
}) {
  let personaSnapshot: Record<string, unknown> = {};
  if (input.personaId) {
    const { data: persona } = await supabaseAdmin().from('personas').select('*').eq('id', input.personaId).single();
    personaSnapshot = persona ?? {};
  } else if (input.sessionId) {
    const { data: session } = await supabaseAdmin()
      .from('practice_sessions')
      .select('persona_snapshot')
      .eq('id', input.sessionId)
      .single();
    personaSnapshot = session?.persona_snapshot ?? {};
  }

  const transcript = await bestTranscriptFor(input.personaId, input.sessionId, input.workspaceId);
  const content = await generatePlaybookContent(input.workspaceId, { personaSnapshot, bestTranscript: transcript });

  const { data: playbook, error } = await supabaseAdmin()
    .from('playbooks')
    .insert({
      workspace_id: input.workspaceId,
      created_by_user_id: input.userId,
      title: input.title ?? `Playbook — ${personaSnapshot.name ?? 'Persona'}`,
    })
    .select('id')
    .single();
  if (error || !playbook) throw ApiError.internal('Failed to create playbook.');

  const version = await insertVersion(playbook.id, content, 1);
  await supabaseAdmin().from('playbooks').update({ current_version_id: version.id }).eq('id', playbook.id);

  return getPlaybookById(playbook.id, input.workspaceId);
}

async function insertVersion(playbookId: string, content: Awaited<ReturnType<typeof generatePlaybookContent>>, versionNumber: number) {
  const { data, error } = await supabaseAdmin()
    .from('playbook_versions')
    .insert({
      playbook_id: playbookId,
      version_number: versionNumber,
      opening_message: content.opening_message,
      discovery_questions: content.discovery_questions,
      objection_responses: content.objection_responses,
      closing_cta: content.closing_cta,
      key_insight: content.key_insight,
    })
    .select('id')
    .single();
  if (error || !data) throw ApiError.internal('Failed to save playbook version.');
  return data;
}

export async function regeneratePlaybook(playbookId: string, workspaceId: string, userId: string) {
  const { data: playbook } = await supabaseAdmin()
    .from('playbooks')
    .select('id, current_version_id')
    .eq('id', playbookId)
    .eq('workspace_id', workspaceId)
    .single();
  if (!playbook) throw ApiError.notFound('Playbook not found.');

  const { count } = await supabaseAdmin()
    .from('playbook_versions')
    .select('id', { count: 'exact', head: true })
    .eq('playbook_id', playbookId);

  // Regenerating without a specific persona/session simply re-runs against
  // whatever grounding is still resolvable; a full "incorporate latest
  // sessions" re-grounding is a reasonable follow-up refinement.
  const { data: existingVersion } = await supabaseAdmin()
    .from('playbook_versions')
    .select('*')
    .eq('id', playbook.current_version_id)
    .single();

  const content = await generatePlaybookContent(workspaceId, {
    personaSnapshot: {},
    bestTranscript: `${existingVersion.opening_message}\n${existingVersion.key_insight}`,
  });

  const version = await insertVersion(playbookId, content, (count ?? 0) + 1);
  await supabaseAdmin().from('playbooks').update({ current_version_id: version.id }).eq('id', playbookId);
  return getPlaybookById(playbookId, workspaceId);
}

export async function getPlaybookById(playbookId: string, workspaceId: string) {
  const { data: playbook } = await supabaseAdmin()
    .from('playbooks')
    .select('*, playbook_versions!playbooks_current_version_id_fkey(*)')
    .eq('id', playbookId)
    .eq('workspace_id', workspaceId)
    .single();
  if (!playbook) throw ApiError.notFound('Playbook not found.');
  return playbook;
}

export async function listPlaybookVersions(playbookId: string, workspaceId: string) {
  await getPlaybookById(playbookId, workspaceId);
  const { data } = await supabaseAdmin()
    .from('playbook_versions')
    .select('*')
    .eq('playbook_id', playbookId)
    .order('version_number', { ascending: false });
  return data ?? [];
}

export async function sharePlaybook(playbookId: string, workspaceId: string, attributionEnabled: boolean) {
  const token = randomBytes(16).toString('base64url');
  await supabaseAdmin()
    .from('playbooks')
    .update({ share_token: token, share_attribution_enabled: attributionEnabled })
    .eq('id', playbookId)
    .eq('workspace_id', workspaceId);
  return { share_token: token };
}

export async function revokeShare(playbookId: string, workspaceId: string) {
  await supabaseAdmin().from('playbooks').update({ share_token: null }).eq('id', playbookId).eq('workspace_id', workspaceId);
}

export async function getPublicPlaybook(token: string) {
  const { data } = await supabaseAdmin()
    .from('playbooks')
    .select('title, share_attribution_enabled, playbook_versions!playbooks_current_version_id_fkey(*)')
    .eq('share_token', token)
    .maybeSingle();
  if (!data) throw ApiError.notFound('This playbook link is invalid or has been revoked.');
  return data;
}
