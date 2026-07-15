import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { notify } from '../../modules/notifications/notifications.service';

export async function sendWeeklySummaryHandler(job: Job<{ userId: string; workspaceId: string }>): Promise<void> {
  const { userId, workspaceId } = job.data;

  const { data: prefs } = await supabaseAdmin().from('notification_preferences').select('weekly_summary_enabled').eq('user_id', userId).maybeSingle();
  if (prefs && prefs.weekly_summary_enabled === false) return;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { count: sessionsThisWeek } = await supabaseAdmin()
    .from('practice_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'completed')
    .gte('completed_at', weekAgo.toISOString());

  if (!sessionsThisWeek) return; // no activity — skip rather than send an empty summary

  await notify({
    userId,
    channel: 'email',
    type: 'weekly_summary',
    title: 'Your DryRun week in review',
    body: `You completed ${sessionsThisWeek} practice session(s) this week.`,
    emailHtml: `<p>You completed <strong>${sessionsThisWeek}</strong> practice session(s) this week. Keep it up.</p>`,
  });
}
