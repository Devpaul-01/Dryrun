import { Job } from 'bullmq';
import { supabaseAdmin } from '../../config/supabase';
import { notify } from '../../modules/notifications/notifications.service';
import { createLogger } from '../../config/logger';

const log = createLogger('send-weekly-summary-worker');

const AXIS_LABELS: Record<string, string> = {
  clarity: 'Clarity',
  value: 'Value Communication',
  discovery: 'Discovery Questions',
  objection_handling: 'Objection Handling',
  brevity: 'Brevity',
  cta_strength: 'Call-to-Action Strength',
};

interface WeeklySummaryData {
  sessionsThisWeek: number;
  daysActiveThisWeek: number;
  compositeScoreThisWeek: number | null;
  compositeScoreLastWeek: number | null;
  strongestAxis: string | null;
  weakestAxis: string | null;
  goalsSetThisWeek: number;
  goalsAchievedThisWeek: number | null; // null, not 0, when goal_achieved can't be trusted — see note below
  newBadgesThisWeek: { label: string; description: string }[];
  bestCoachableMoment: string | null;
  currentCurriculumWeakness: string | null;
}

/**
 * Gathers every data point the enriched weekly summary needs, in one
 * place, so the email-building step below stays pure formatting logic
 * with no query concerns mixed in.
 *
 * NOTE on goal completion: session_goals.goal_achieved is now written by
 * session.service.ts's sendMessage() — the AI judges achievement
 * directly on each turn (see promptBuilder.ts's per-goal-type criteria),
 * and the backend locks in a true value permanently once reached. This
 * function previously worked around goal_achieved having no writer at
 * all by hiding the achievement count whenever nothing in the batch
 * showed true, since a real "0 achieved" was indistinguishable from "not
 * tracked yet." That workaround is removed now that the field is
 * genuinely populated — goalsAchievedThisWeek below reports the real
 * count, including a genuine zero, whenever at least one goal was set.
 */
async function gatherWeeklySummaryData(userId: string, workspaceId: string): Promise<WeeklySummaryData> {
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const [
    { data: completedThisWeek },
    { data: scoresThisWeek },
    { data: scoresLastWeek },
    { data: goalsThisWeek },
    { data: newBadges },
    { data: recentDebriefs },
    { data: curriculum },
  ] = await Promise.all([
    supabaseAdmin()
      .from('practice_sessions')
      .select('id, completed_at')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .eq('status', 'completed')
      .gte('completed_at', weekAgo.toISOString()),
    supabaseAdmin()
      .from('session_skill_scores')
      .select('composite_score, weakest_axis, strongest_axis, session_id, practice_sessions!inner(user_id, workspace_id, completed_at)')
      .eq('practice_sessions.user_id', userId)
      .eq('practice_sessions.workspace_id', workspaceId)
      .gte('practice_sessions.completed_at', weekAgo.toISOString()),
    supabaseAdmin()
      .from('session_skill_scores')
      .select('composite_score, practice_sessions!inner(user_id, workspace_id, completed_at)')
      .eq('practice_sessions.user_id', userId)
      .eq('practice_sessions.workspace_id', workspaceId)
      .gte('practice_sessions.completed_at', twoWeeksAgo.toISOString())
      .lt('practice_sessions.completed_at', weekAgo.toISOString()),
    supabaseAdmin()
      .from('session_goals')
      .select('goal_type, goal_achieved, practice_sessions!inner(user_id, workspace_id, completed_at)')
      .eq('practice_sessions.user_id', userId)
      .eq('practice_sessions.workspace_id', workspaceId)
      .gte('practice_sessions.completed_at', weekAgo.toISOString()),
    supabaseAdmin()
      .from('badges')
      .select('badge_label, badge_description')
      .eq('user_id', userId)
      .gte('earned_at', weekAgo.toISOString()),
    supabaseAdmin()
      .from('session_debriefs')
      .select('coachable_moment, session_id, practice_sessions!inner(user_id, workspace_id, completed_at)')
      .eq('practice_sessions.user_id', userId)
      .eq('practice_sessions.workspace_id', workspaceId)
      .gte('practice_sessions.completed_at', weekAgo.toISOString())
      .order('practice_sessions(completed_at)', { ascending: false })
      .limit(1),
    supabaseAdmin()
      .from('curriculum_plans')
      .select('weakness_identified')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const sessionsThisWeek = completedThisWeek?.length ?? 0;
  const daysActiveThisWeek = new Set(
    (completedThisWeek ?? []).map((s) => (s.completed_at ? new Date(s.completed_at).toDateString() : null)).filter(Boolean)
  ).size;

  const avg = (rows: { composite_score: number }[] | null) =>
    rows && rows.length > 0 ? rows.reduce((sum, r) => sum + r.composite_score, 0) / rows.length : null;

  // Strongest/weakest axis this week: the mode (most frequent) across the
  // week's sessions, not just the last session's — a single outlier
  // session shouldn't dominate the week's headline strength/weakness.
  const modeAxis = (rows: { weakest_axis?: string; strongest_axis?: string }[] | null, key: 'weakest_axis' | 'strongest_axis') => {
    if (!rows || rows.length === 0) return null;
    const counts = new Map<string, number>();
    for (const r of rows) {
      const val = r[key];
      if (val) counts.set(val, (counts.get(val) ?? 0) + 1);
    }
    if (counts.size === 0) return null;
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
  };

  // See this function's header comment: goal_achieved has no writer
  // anywhere in the codebase today, so treat an all-null/all-false result
  // as "not actually tracked" rather than "0 achieved" when there ARE
  // goals set but the achieved flag never differs from its default.
  const goalsSetThisWeek = goalsThisWeek?.length ?? 0;
  const goalsAchievedThisWeek = goalsSetThisWeek > 0 ? (goalsThisWeek ?? []).filter((g) => g.goal_achieved === true).length : null;

  return {
    sessionsThisWeek,
    daysActiveThisWeek,
    compositeScoreThisWeek: avg(scoresThisWeek as any),
    compositeScoreLastWeek: avg(scoresLastWeek as any),
    strongestAxis: modeAxis(scoresThisWeek as any, 'strongest_axis'),
    weakestAxis: modeAxis(scoresThisWeek as any, 'weakest_axis'),
    goalsSetThisWeek,
    goalsAchievedThisWeek,
    newBadgesThisWeek: (newBadges ?? []).map((b) => ({ label: b.badge_label, description: b.badge_description })),
    bestCoachableMoment: recentDebriefs?.[0]?.coachable_moment ?? null,
    currentCurriculumWeakness: curriculum?.weakness_identified ?? null,
  };
}

function buildWeeklySummaryEmailHtml(data: WeeklySummaryData): string {
  const sections: string[] = [];

  sections.push(
    `<p>You completed <strong>${data.sessionsThisWeek}</strong> practice session${data.sessionsThisWeek === 1 ? '' : 's'} across <strong>${data.daysActiveThisWeek}</strong> day${data.daysActiveThisWeek === 1 ? '' : 's'} this week.</p>`
  );

  if (data.compositeScoreThisWeek !== null) {
    const rounded = Math.round(data.compositeScoreThisWeek);
    let trendHtml = '';
    if (data.compositeScoreLastWeek !== null) {
      const delta = data.compositeScoreThisWeek - data.compositeScoreLastWeek;
      const direction = delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'holding steady';
      const deltaText = Math.abs(delta) >= 0.5 ? ` (${direction} ${Math.abs(Math.round(delta))} points from last week)` : ' (holding steady vs. last week)';
      trendHtml = deltaText;
    }
    sections.push(`<p>Your average score this week: <strong>${rounded}/100</strong>${trendHtml}.</p>`);
  }

  if (data.strongestAxis || data.weakestAxis) {
    const parts: string[] = [];
    if (data.strongestAxis) parts.push(`<strong>${AXIS_LABELS[data.strongestAxis] ?? data.strongestAxis}</strong> was your strongest area`);
    if (data.weakestAxis) parts.push(`<strong>${AXIS_LABELS[data.weakestAxis] ?? data.weakestAxis}</strong> is the best place to focus next`);
    sections.push(`<p>${parts.join(', and ')}.</p>`);
  }

  // goalsAchievedThisWeek is null only when zero goals were set this week
  // (see gatherWeeklySummaryData) — this guard just skips an empty
  // "0 of 0 goals" line, not a data-quality workaround.
  if (data.goalsSetThisWeek > 0 && data.goalsAchievedThisWeek !== null) {
    sections.push(
      `<p>You set <strong>${data.goalsSetThisWeek}</strong> session goal${data.goalsSetThisWeek === 1 ? '' : 's'} this week and achieved <strong>${data.goalsAchievedThisWeek}</strong> of them.</p>`
    );
  }

  if (data.newBadgesThisWeek.length > 0) {
    const badgeItems = data.newBadgesThisWeek.map((b) => `<li><strong>${b.label}</strong> — ${b.description}</li>`).join('');
    sections.push(`<p>New achievements this week:</p><ul>${badgeItems}</ul>`);
  }

  if (data.bestCoachableMoment) {
    sections.push(`<p><em>Coaching highlight from this week:</em> ${data.bestCoachableMoment}</p>`);
  }

  if (data.currentCurriculumWeakness) {
    sections.push(
      `<p><em>Suggested focus for next week:</em> your current recommended curriculum is built around strengthening <strong>${AXIS_LABELS[data.currentCurriculumWeakness] ?? data.currentCurriculumWeakness}</strong>.</p>`
    );
  }

  sections.push(`<p>Keep practicing — consistency compounds.</p>`);

  return sections.join('\n');
}

function buildWeeklySummaryPlainText(data: WeeklySummaryData): string {
  const parts = [`You completed ${data.sessionsThisWeek} practice session(s) this week.`];
  if (data.compositeScoreThisWeek !== null) parts.push(`Average score: ${Math.round(data.compositeScoreThisWeek)}/100.`);
  return parts.join(' ');
}

export async function sendWeeklySummaryHandler(job: Job<{ userId: string; workspaceId: string }>): Promise<void> {
  const { userId, workspaceId } = job.data;

  const { data: prefs } = await supabaseAdmin().from('notification_preferences').select('weekly_summary_enabled').eq('user_id', userId).maybeSingle();
  if (prefs && prefs.weekly_summary_enabled === false) return;

  let data: WeeklySummaryData;
  try {
    data = await gatherWeeklySummaryData(userId, workspaceId);
  } catch (err) {
    log.error({ err, userId, workspaceId }, 'Failed to gather weekly summary data');
    return;
  }

  if (data.sessionsThisWeek === 0) return; // no activity — skip rather than send an empty summary

  await notify({
    userId,
    channel: 'email',
    type: 'weekly_summary',
    title: 'Your DryRun week in review',
    body: buildWeeklySummaryPlainText(data),
    emailHtml: buildWeeklySummaryEmailHtml(data),
  });
}
