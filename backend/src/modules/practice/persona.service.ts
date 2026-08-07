import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../lib/apiError';
import { enqueue } from '../../jobs/queues';
import { trackEvent } from '../analytics/analytics.service';
import { cached, invalidateTag, cacheKeys, cacheTags, CACHE_TTL } from '../../config/cache';

/**
 * Cached list, tagged so any persona mutation for this workspace
 * (createManualPersona, createPersonaFromSource, the async
 * synthesizePersona.worker completion, updatePersona, deletePersona) can
 * invalidate it via `invalidateTag(cacheTags.personasWorkspace(workspaceId))`
 * without needing to know the exact cache key shape.
 */
export async function listPersonas(workspaceId: string) {
  return cached(cacheKeys.personasList(workspaceId), { ttlSeconds: CACHE_TTL.LIST_MINUTES_2, tags: [cacheTags.personasWorkspace(workspaceId)] }, async () => {
    const { data } = await supabaseAdmin()
      .from('personas')
      .select('id, name, role, source_type, reusable, created_at')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100); // offset-acceptable at current expected scale, per architecture §2.10 note
    return data ?? [];
  });
}

export async function createManualPersona(
  workspaceId: string,
  userId: string,
  input: {
    name: string;
    role: string;
    company_context?: string;
    main_pain: string;
    skepticism_about: string;
    communication_style?: string;
  }
) {
  const { data, error } = await supabaseAdmin()
    .from('personas')
    .insert({
      workspace_id: workspaceId,
      created_by_user_id: userId,
      name: input.name,
      role: input.role,
      company_context: input.company_context ?? null,
      main_pain: input.main_pain,
      skepticism_about: input.skepticism_about,
      communication_style: input.communication_style ?? 'professional and direct',
      source_type: 'generated',
      reusable: true,
    })
    .select('*')
    .single();
  if (error || !data) throw ApiError.internal('Failed to create persona.');

  await invalidateTag(cacheTags.personasWorkspace(workspaceId));
  await trackEvent('persona_created', { userId, workspaceId }, { sourceType: 'manual' });
  return data;
}

/**
 * Kicks off the persona-from-source ingestion pipeline. Pasted text
 * synthesizes fast enough to feel synchronous; URL/upload sources are
 * queued and the client is notified via a Supabase Realtime channel
 * scoped to the returned persona ID (see realtime/channels.ts).
 *
 * Invalidates the list cache here (the placeholder "Generating…" persona
 * is now visible in a list read) AND again from
 * jobs/workers/synthesizePersona.worker.ts once the real content lands —
 * both writes are visible mutations of what listPersonas() returns.
 */
export async function createPersonaFromSource(input: {
  workspaceId: string;
  userId: string;
  scenarioType: string;
  sourceKind: 'pasted_text' | 'url' | 'upload';
  pastedText?: string;
  url?: string;
  uploadId?: string;
}) {
  const { data: persona, error } = await supabaseAdmin()
    .from('personas')
    .insert({
      workspace_id: input.workspaceId,
      created_by_user_id: input.userId,
      name: 'Generating…',
      role: 'Generating…',
      main_pain: '',
      skepticism_about: '',
      source_type:
        input.sourceKind === 'pasted_text' ? 'combined' : input.sourceKind === 'url' ? 'company_url' : 'document',
      reusable: true,
    })
    .select('id')
    .single();
  if (error || !persona) throw ApiError.internal('Failed to initialize persona.');

  const { data: source, error: sourceError } = await supabaseAdmin()
    .from('persona_sources')
    .insert({
      persona_id: persona.id,
      source_kind: input.sourceKind,
      raw_reference: input.pastedText ?? input.url ?? input.uploadId ?? '',
      extracted_text: input.sourceKind === 'pasted_text' ? input.pastedText : null,
      status: input.sourceKind === 'pasted_text' ? 'extracted' : 'pending',
    })
    .select('id')
    .single();
  if (sourceError || !source) throw ApiError.internal('Failed to record persona source.');

  if (input.sourceKind === 'pasted_text') {
    await enqueue('persona-ingestion', 'synthesize_persona', {
      personaId: persona.id,
      personaSourceId: source.id,
      workspaceId: input.workspaceId,
      scenarioType: input.scenarioType,
    });
  } else {
    await enqueue('persona-ingestion', 'extract_persona_source', {
      personaId: persona.id,
      personaSourceId: source.id,
      workspaceId: input.workspaceId,
      scenarioType: input.scenarioType,
      sourceKind: input.sourceKind,
    });
  }

  await invalidateTag(cacheTags.personasWorkspace(input.workspaceId));
  await trackEvent('persona_created', { userId: input.userId, workspaceId: input.workspaceId }, {
    sourceType: input.sourceKind,
  });

  return persona;
}

export async function getPersonaById(id: string, workspaceId: string) {
  const { data, error } = await supabaseAdmin()
    .from('personas')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .single();
  if (error || !data) throw ApiError.notFound('Persona not found.');
  return data;
}

export async function updatePersona(id: string, workspaceId: string, updates: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin()
    .from('personas')
    .update(updates)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .select('*')
    .single();
  if (error || !data) throw ApiError.notFound('Persona not found.');

  await invalidateTag(cacheTags.personasWorkspace(workspaceId));
  return data;
}

export async function deletePersona(id: string, workspaceId: string) {
  const { data, error } = await supabaseAdmin()
    .from('personas')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) throw ApiError.notFound('Persona not found.');

  await invalidateTag(cacheTags.personasWorkspace(workspaceId));
}
