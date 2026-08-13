import { supabaseAdmin } from '../../config/supabase';
import { cached, invalidate, cacheKeys, CACHE_TTL } from '../../config/cache';

interface BadgeCandidate {
  type: string;
  label: string;
  description: string;
  condition: boolean;
}

/** Called as a side effect of session completion — no separate polling job. */
export async function checkAndAwardBadges(userId: string, workspaceId: string, scenarioType: string): Promise<void> {
  const { data: earned } = await supabaseAdmin().from('badges').select('badge_type').eq('user_id', userId);
  const earnedSet = new Set((earned ?? []).map((b) => b.badge_type));

  const { count: totalCompleted } = await supabaseAdmin()
    .from('practice_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'completed');

  const candidates: BadgeCandidate[] = [
    { type: 'first_session', label: '🎯 First Steps', description: 'Completed your first practice session', condition: (totalCompleted ?? 0) >= 1 },
    { type: '5_sessions', label: '🔥 Getting Comfortable', description: '5 sessions complete', condition: (totalCompleted ?? 0) >= 5 },
    { type: '10_sessions', label: '⚡ Rejection Proof', description: '10 sessions done', condition: (totalCompleted ?? 0) >= 10 },
    { type: '25_sessions', label: '🏆 Practice Pro', description: '25 sessions — a real habit built', condition: (totalCompleted ?? 0) >= 25 },
    { type: 'ghostbuster', label: '👻 Ghostbuster', description: 'Earned a reply from Radio Silence', condition: scenarioType === 'radio_silence' },
  ];

  let awardedAny = false;
  for (const candidate of candidates) {
    if (candidate.condition && !earnedSet.has(candidate.type)) {
      await supabaseAdmin().from('badges').insert({
        user_id: userId,
        workspace_id: workspaceId,
        badge_type: candidate.type,
        badge_label: candidate.label,
        badge_description: candidate.description,
      });
      awardedAny = true;
    }
  }

  if (awardedAny) {
    await invalidate(cacheKeys.badgesList(userId));
  }
}

export async function listBadges(userId: string) {
  return cached(cacheKeys.badgesList(userId), { ttlSeconds: CACHE_TTL.LIST_MINUTES_2 }, async () => {
    const { data } = await supabaseAdmin().from('badges').select('*').eq('user_id', userId).order('earned_at', { ascending: false });
    return data ?? [];
  });
}
