import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { generatePersona } from '../../modules/ai/ai.service';
import { publishStatus } from '../../realtime/channels';
import { createLogger } from '../../config/logger';
import { invalidateTag, cacheTags } from '../../config/cache';

const log = createLogger('synthesize-persona-worker');

export async function synthesizePersonaHandler(
  job: Job<{ personaId: string; personaSourceId: string; workspaceId: string; scenarioType: string }>
): Promise<void> {
  const { personaId, personaSourceId, workspaceId, scenarioType } = job.data;

  const { data: source } = await supabaseAdmin().from('persona_sources').select('extracted_text').eq('id', personaSourceId).single();
  const { data: practiceProfile } = await supabaseAdmin()
    .from('practice_profiles')
    .select('product_description, target_audience')
    .eq('workspace_id', workspaceId)
    .limit(1)
    .maybeSingle();

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
