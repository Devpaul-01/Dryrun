import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { generatePersona } from '../../modules/ai/ai.service';
import { publishStatus } from '../../realtime/channels';
import { createLogger } from '../../config/logger';
import { invalidateTag, cacheTags } from '../../config/cache';

const log = createLogger('synthesize-persona-worker');

export async function synthesizePersonaHandler(
  job: Job<{ personaId: string; personaSourceId: string; workspaceId: string; userId?: string; scenarioType: string }>
): Promise<void> {
  const { personaId, personaSourceId, workspaceId, userId, scenarioType } = job.data;

  const { data: source } = await supabaseAdmin().from('persona_sources').select('extracted_text').eq('id', personaSourceId).single();

  /**
   * DATA-ISOLATION FIX (item #9, practice-profile scoping review): this
   * query used to filter by workspace_id alone with `.limit(1)`, which —
   * since practice_profiles is uniquely keyed on (user_id, workspace_id),
   * meaning multiple members of the same workspace each have their own
   * profile row — meant this worker could pick an ARBITRARY member's
   * product_description/target_audience to ground a persona for a job
   * a DIFFERENT member actually initiated, whenever more than one
   * workspace member had completed onboarding. Now scoped by both
   * user_id and workspace_id, matching the same (user_id, workspace_id)
   * key every other read/write of this table already uses correctly
   * (onboarding.routes.ts, session.service.ts). Falls back to a
   * workspace-only lookup only if userId is unavailable (older enqueued
   * jobs from before this fix that are still in a queue at deploy time),
   * logged loudly since that fallback reintroduces the exact ambiguity
   * being fixed here.
   */
  let practiceProfile: { product_description: string; target_audience: string } | null = null;
  if (userId) {
    const { data } = await supabaseAdmin()
      .from('practice_profiles')
      .select('product_description, target_audience')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    practiceProfile = data;
  } else {
    log.warn(
      { personaId, workspaceId },
      'synthesizePersonaHandler received a job with no userId — falling back to an unscoped workspace lookup, which may select the wrong member\'s practice profile. This should only happen for jobs enqueued before the userId-threading fix deployed.'
    );
    const { data } = await supabaseAdmin()
      .from('practice_profiles')
      .select('product_description, target_audience')
      .eq('workspace_id', workspaceId)
      .limit(1)
      .maybeSingle();
    practiceProfile = data;
  }

  try {
    const generated = await generatePersona({
      workspaceId,
      practiceProfile: {
        productDescription: practiceProfile?.product_description ?? 'not specified',
        targetAudience: practiceProfile?.target_audience ?? 'not specified',
      },
      scenarioType,
      sourceText: source?.extracted_text ?? undefined,
    });

    await supabaseAdmin()
      .from('personas')
      .update({
        name: generated.name,
        role: generated.role,
        company_context: generated.company_context,
        main_pain: generated.main_pain,
        skepticism_about: generated.skepticism_about,
        communication_style: generated.communication_style,
        hidden_motivations: generated.hidden_motivations,
      })
      .eq('id', personaId);

    await supabaseAdmin().from('persona_sources').update({ status: 'synthesized' }).eq('id', personaSourceId);

    // The workspace's persona list cache still holds the "Generating…"
    // placeholder from createPersonaFromSource() until this invalidates it.
    await invalidateTag(cacheTags.personasWorkspace(workspaceId));
    await publishStatus('persona', personaId, 'ready_for_review', { personaId });
  } catch (err) {
    log.error({ err, personaId }, 'Persona synthesis failed');
    await publishStatus('persona', personaId, 'synthesis_failed', { personaId });
  }
}
