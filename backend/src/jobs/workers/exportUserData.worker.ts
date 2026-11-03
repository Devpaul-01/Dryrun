import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { STORAGE_BUCKET } from '../../modules/files/upload.service';
import { notify } from '../../modules/notifications/notifications.service';
import { createLogger } from '../../config/logger';

const log = createLogger('export-user-data-worker');

export async function exportUserDataHandler(job: Job<{ userId: string }>): Promise<void> {
  const { userId } = job.data;

  // FIX (backend-takeover audit, Task #14 — GDPR export completeness):
  // The export previously only pulled `users`, `practice_sessions`,
  // `personas`, and `playbooks` via a top-level `.select('*')` each. On
  // Supabase/PostgREST, `.select('*')` never auto-joins related tables, so
  // every child table that stores the actual content of a session, persona,
  // or playbook — rather than just its header row — was silently omitted
  // from a "download all my data" export. Verified directly against
  // Postgres: `practice_sessions` rows exist with zero columns overlapping
  // `session_messages`, so a user's own sales-call transcript, AI debrief
  // feedback, skill scores, stated goals, and conversational state history
  // were never included despite living entirely under their own user_id
  // (transitively, via session_id -> practice_sessions.user_id).
  //
  // Also added: practice_profiles, curriculum_plans, badges,
  // user_skill_trend, notification_preferences, push_tokens, uploads (all
  // directly user_id-scoped), persona_sources (via persona_id ->
  // personas.created_by_user_id), and playbook_versions (via playbook_id ->
  // playbooks.created_by_user_id) — i.e. the actual playbook script content,
  // not just its title/metadata row.
  //
  // Deliberately still excluded: workspace-level tables (subscriptions,
  // payment_transactions, workspace_members, workspace_invites) and
  // system/internal tables (plans, system_config, webhook_events,
  // audit_log, analytics_events, ai_usage_log, ai_scoring_evaluations). The
  // workspace-level ones involve other workspace members' data and aren't
  // this user's personal data to begin with; a correct "my billing
  // history" export would need workspace-scoped access control this
  // single-user-keyed export doesn't have, so it's left out rather than
  // leaking teammates' payment data.
  const [{ data: profile }, { data: sessions }, { data: personas }, { data: playbooks }, { data: practiceProfiles }] =
    await Promise.all([
      supabaseAdmin().from('users').select('id, email, display_name, created_at').eq('id', userId).single(),
      supabaseAdmin().from('practice_sessions').select('*').eq('user_id', userId),
      supabaseAdmin().from('personas').select('*').eq('created_by_user_id', userId),
      supabaseAdmin().from('playbooks').select('*').eq('created_by_user_id', userId),
      supabaseAdmin().from('practice_profiles').select('*').eq('user_id', userId),
    ]);

  const sessionIds = (sessions ?? []).map((s) => s.id);
  const personaIds = (personas ?? []).map((p) => p.id);
  const playbookIds = (playbooks ?? []).map((p) => p.id);

  const [
    { data: sessionMessages },
    { data: sessionDebriefs },
    { data: sessionSkillScores },
    { data: sessionGoals },
    { data: sessionContextSummaries },
    { data: sessionStateSnapshots },
    { data: sessionRetries },
    { data: personaSources },
    { data: playbookVersions },
    { data: curriculumPlans },
    { data: badges },
    { data: userSkillTrend },
    { data: notificationPreferences },
    { data: pushTokens },
    { data: uploads },
  ] = await Promise.all([
    sessionIds.length
      ? supabaseAdmin().from('session_messages').select('*').in('session_id', sessionIds)
      : Promise.resolve({ data: [] as unknown[] }),
    sessionIds.length
      ? supabaseAdmin().from('session_debriefs').select('*').in('session_id', sessionIds)
      : Promise.resolve({ data: [] as unknown[] }),
    sessionIds.length
      ? supabaseAdmin().from('session_skill_scores').select('*').in('session_id', sessionIds)
      : Promise.resolve({ data: [] as unknown[] }),
    sessionIds.length
      ? supabaseAdmin().from('session_goals').select('*').in('session_id', sessionIds)
      : Promise.resolve({ data: [] as unknown[] }),
    sessionIds.length
      ? supabaseAdmin().from('session_context_summaries').select('*').in('session_id', sessionIds)
      : Promise.resolve({ data: [] as unknown[] }),
    sessionIds.length
      ? supabaseAdmin().from('session_state_snapshots').select('*').in('session_id', sessionIds)
      : Promise.resolve({ data: [] as unknown[] }),
    sessionIds.length
      ? supabaseAdmin().from('session_retries').select('*').in('original_session_id', sessionIds)
      : Promise.resolve({ data: [] as unknown[] }),
    personaIds.length
      ? supabaseAdmin().from('persona_sources').select('*').in('persona_id', personaIds)
      : Promise.resolve({ data: [] as unknown[] }),
    playbookIds.length
      ? supabaseAdmin().from('playbook_versions').select('*').in('playbook_id', playbookIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabaseAdmin().from('curriculum_plans').select('*').eq('user_id', userId),
    supabaseAdmin().from('badges').select('*').eq('user_id', userId),
    supabaseAdmin().from('user_skill_trend').select('*').eq('user_id', userId),
    supabaseAdmin().from('notification_preferences').select('*').eq('user_id', userId),
    supabaseAdmin().from('push_tokens').select('id, token, platform, created_at').eq('user_id', userId),
    supabaseAdmin().from('uploads').select('*').eq('user_id', userId),
  ]);

  const exportPayload = {
    profile,
    practice_profiles: practiceProfiles,
    sessions,
    session_messages: sessionMessages,
    session_debriefs: sessionDebriefs,
    session_skill_scores: sessionSkillScores,
    session_goals: sessionGoals,
    session_context_summaries: sessionContextSummaries,
    session_state_snapshots: sessionStateSnapshots,
    session_retries: sessionRetries,
    personas,
    persona_sources: personaSources,
    playbooks,
    playbook_versions: playbookVersions,
    curriculum_plans: curriculumPlans,
    badges,
    user_skill_trend: userSkillTrend,
    notification_preferences: notificationPreferences,
    push_tokens: pushTokens,
    uploads,
    exported_at: new Date().toISOString(),
  };
  const exportPath = `exports/${userId}-${Date.now()}.json`;

  const { error } = await supabaseAdmin()
    .storage.from(STORAGE_BUCKET)
    .upload(exportPath, JSON.stringify(exportPayload, null, 2), { contentType: 'application/json' });

  if (error) {
    log.error({ error, userId }, 'Failed to write data export');
    return;
  }

  const { data: signed } = await supabaseAdmin().storage.from(STORAGE_BUCKET).createSignedUrl(exportPath, 60 * 60 * 24 * 7);

  await notify({
    userId,
    channel: 'email',
    type: 'data_export_ready',
    title: 'Your DryRun data export is ready',
    body: 'Your requested data export is ready to download.',
    emailHtml: `<p>Your data export is ready: <a href="${signed?.signedUrl}">${signed?.signedUrl}</a></p><p>This link expires in 7 days.</p>`,
  });
}
