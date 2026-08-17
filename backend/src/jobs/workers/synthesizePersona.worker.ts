import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { generatePersona } from '../../modules/ai/ai.service';
import { publishStatus } from '../../realtime/channels';
import { createLogger } from '../../config/logger';

const log = createLogger('synthesize-persona-worker');

export async function synthesizePersonaHandler(
  job: Job<{ personaId: string; personaSourceId: string; workspaceId: string; scenarioType?: string }>
): Promise<void> {
  const { personaId, personaSourceId, workspaceId } = job.data;

  // FIX (audit finding C1): this used to resolve practice_profiles by
  // workspace_id alone. practice_profiles has a unique(user_id,
  // workspace_id) constraint — a single workspace can legitimately have
  // multiple rows, one per member — so `.limit(1)` with no user_id filter
  // picked an arbitrary member's profile. In any workspace with 2+ members
  // who had each completed Instant Setup, persona generation for one user
  // could silently ground itself in a different member's product/audience
  // description. Fixed by resolving the initiating user from the persona
  // row itself: created_by_user_id is set at persona creation time
  // (persona.service.ts's createPersonaFromSource) and requires no schema
  // change or job-payload threading to look up here, since every path
  // through this worker already carries personaId.
  //
  // updated_at is captured in the same read and used below for the
  // optimistic-concurrency check (audit finding M2).
  const { data: personaRow, error: personaRowError } = await supabaseAdmin()
    .from('personas')
    .select('created_by_user_id, updated_at')
    .eq('id', personaId)
    .single();

  if (personaRowError || !personaRow) {
    log.error({ err: personaRowError, personaId }, 'Persona synthesis: could not resolve persona row — aborting');
    await publishStatus('persona', personaId, 'synthesis_failed', { personaId });
    // Best-effort — if the row itself couldn't be resolved above, this
    // write may also fail to match, which is fine; the realtime broadcast
    // already carries the failure signal for this branch.
    await supabaseAdmin().from('personas').update({ generation_status: 'failed' }).eq('id', personaId);
    return;
  }

  const capturedUpdatedAt = personaRow.updated_at;

  // scenario_type is read from persona_sources (durable, set at ingestion
  // time) rather than trusted solely from the job payload — see the
  // matching comment in extractPersonaSource.worker.ts and audit finding
  // C1a. Falling back to job.data.scenarioType covers the pasted_text path,
  // which enqueues this job directly without going through
  // extractPersonaSource.worker.ts's own resolution step.
  const { data: source } = await supabaseAdmin()
    .from('persona_sources')
    .select('extracted_text, scenario_type')
    .eq('id', personaSourceId)
    .single();
  const scenarioType = source?.scenario_type ?? job.data.scenarioType ?? '';

  const { data: practiceProfile } = await supabaseAdmin()
    .from('practice_profiles')
    .select('product_description, target_audience')
    .eq('workspace_id', workspaceId)
    .eq('user_id', personaRow.created_by_user_id)
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

    // FIX (audit finding M2): this update used to be unconditional
    // (.eq('id', personaId) only). If a user manually edited the
    // "Generating…" placeholder via PATCH /personas/:id while synthesis
    // was still in flight, this write would silently overwrite that edit
    // once the background job completed. Fixed with an optimistic-
    // concurrency check against the updated_at value captured above, at
    // the start of this handler, before generatePersona()'s AI call ran —
    // any PATCH that lands during that window will have advanced
    // updated_at (personas has an `updated_at` trigger, see
    // db/schema.sql's set_updated_at()), so this conditional update will
    // match zero rows and the user's own edit wins.
    const { data: updated, error: updateError } = await supabaseAdmin()
      .from('personas')
      .update({
        name: generated.name,
        role: generated.role,
        company_context: generated.company_context,
        main_pain: generated.main_pain,
        skepticism_about: generated.skepticism_about,
        communication_style: generated.communication_style,
        hidden_motivations: generated.hidden_motivations,
        // FIX (audit finding L2): REST polling fallback alongside the
        // realtime broadcast below — see this file's other status writes
        // and personas.generation_status's own schema comment.
        generation_status: 'ready',
      })
      .eq('id', personaId)
      .eq('updated_at', capturedUpdatedAt)
      .select('id')
      .maybeSingle();

    if (updateError) {
      log.error({ err: updateError, personaId }, 'Persona synthesis: final update failed');
      await publishStatus('persona', personaId, 'synthesis_failed', { personaId });
      await supabaseAdmin().from('personas').update({ generation_status: 'failed' }).eq('id', personaId);
      return;
    }

    if (!updated) {
      // The optimistic-concurrency check didn't match — someone (or
      // something) else updated this persona after we captured
      // capturedUpdatedAt. Per this fix's intent, the user's own concurrent
      // edit wins: skip overwriting it and skip the ready_for_review
      // broadcast, since re-announcing "ready for review" over content the
      // user already edited would be misleading.
      log.warn(
        { personaId },
        'Persona synthesis: skipped final write — persona was modified concurrently during synthesis'
      );
      await supabaseAdmin().from('persona_sources').update({ status: 'synthesized' }).eq('id', personaSourceId);
      return;
    }

    await supabaseAdmin().from('persona_sources').update({ status: 'synthesized' }).eq('id', personaSourceId);
    await publishStatus('persona', personaId, 'ready_for_review', { personaId });
  } catch (err) {
    log.error({ err, personaId }, 'Persona synthesis failed');
    await publishStatus('persona', personaId, 'synthesis_failed', { personaId });
    await supabaseAdmin().from('personas').update({ generation_status: 'failed' }).eq('id', personaId);
  }
}
