import { Job } from 'bullmq';
import { runDebriefGeneration } from '../../modules/coaching/debrief.service';
import { publishStatus } from '../../realtime/channels';
import { notify } from '../../modules/notifications/notifications.service';
import { supabaseAdmin } from '../../config/supabase';

export async function generateDebriefHandler(job: Job<{ sessionId: string; workspaceId: string }>): Promise<void> {
  const { sessionId, workspaceId } = job.data;
  await runDebriefGeneration(sessionId, workspaceId);
  await publishStatus('session', sessionId, 'debrief_ready', { sessionId });

  const { data: session } = await supabaseAdmin().from('practice_sessions').select('user_id').eq('id', sessionId).single();
  if (session) {
    const { data: prefs } = await supabaseAdmin()
      .from('notification_preferences')
      .select('async_ready_push_enabled')
      .eq('user_id', session.user_id)
      .maybeSingle();
    if (prefs?.async_ready_push_enabled) {
      await notify({
        userId: session.user_id,
        channel: 'push',
        type: 'debrief_ready',
        title: 'Your debrief is ready',
        body: 'See how that practice session went.',
        data: { sessionId },
      });
    }
  }
}
