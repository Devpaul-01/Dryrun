import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { notify } from '../../modules/notifications/notifications.service';
import { buildPaymentFailedEmailHtml } from '../../modules/notifications/email.service';
import { env } from '../../config/env';

export async function sendPaymentFailedEmailHandler(job: Job<{ workspaceId: string }>): Promise<void> {
  const { data: workspace } = await supabaseAdmin().from('workspaces').select('owner_user_id').eq('id', job.data.workspaceId).single();
  if (!workspace) return;

  await notify({
    userId: workspace.owner_user_id,
    channel: 'email',
    type: 'payment_failed',
    title: "We couldn't process your DryRun payment",
    body: 'Please update your payment method.',
    emailHtml: buildPaymentFailedEmailHtml(`${env.frontendUrl}/billing`),
  });
}
