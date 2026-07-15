import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { STORAGE_BUCKET } from '../../modules/files/upload.service';
import { notify } from '../../modules/notifications/notifications.service';
import { env } from '../../config/env';
import { createLogger } from '../../config/logger';

const log = createLogger('export-user-data-worker');

export async function exportUserDataHandler(job: Job<{ userId: string }>): Promise<void> {
  const { userId } = job.data;

  const [{ data: profile }, { data: sessions }, { data: personas }, { data: playbooks }] = await Promise.all([
    supabaseAdmin().from('users').select('id, email, display_name, created_at').eq('id', userId).single(),
    supabaseAdmin().from('practice_sessions').select('*').eq('user_id', userId),
    supabaseAdmin().from('personas').select('*').eq('created_by_user_id', userId),
    supabaseAdmin().from('playbooks').select('*').eq('created_by_user_id', userId),
  ]);

  const exportPayload = { profile, sessions, personas, playbooks, exported_at: new Date().toISOString() };
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
