import { supabaseAdmin } from '../../config/supabase';
import { cached, invalidate, cacheKeys, CACHE_TTL } from '../../config/cache';
import { createLogger } from '../../config/logger';

const log = createLogger('badges-service');

// Postgres unique_violation SQLSTATE — badges has unique(user_id, badge_type),
// see the FIX comment on checkAndAwardBadges below for why this specific
// code gets treated as an expected outcome rather than a real failure.
const POSTGRES_UNIQUE_VIOLATION = '23505';

interface BadgeCandidate {
  type: string;
  label: string;
  description: string;
  condition: boolean;
}

/**
 * Called as a side effect of session completion — no separate polling job.
 *
 * FIX (audit finding M3): the award insert below previously never checked
 * its returned error, silently masking a failed write. badges has
 * unique(user_id, badge_type) — under a genuine BullMQ retry of the
 * enqueuing job (scoreSessionSkills.worker.ts's queue is configured for
 * up to 3 attempts), or two concurrent completions racing for the same
 * user, a second attempt to award an already-earned badge would hit that
 * constraint and fail, and the old code proceeded as if it had succeeded
 * regardless — logging nothing, still invalidating the cache, with no
 * signal anything had gone wrong. Now checks the error explicitly: a
 * unique-violation is treated as the expected "already awarded by a
 * concurrent/prior attempt" outcome (not re-thrown, not logged as a
 * failure), while any OTHER error is logged clearly rather than silently
 * swallowed — consistent with this codebase's own established convention
 * elsewhere (auth.service.ts, workspace.service.ts, upload.service.ts all
 * check insert/update errors explicitly).
 */
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
      const { error } = await supabaseAdmin().from('badges').insert({
        user_id: userId,
        workspace_id: workspaceId,
        badge_type: candidate.type,
        badge_label: candidate.label,
        badge_description: candidate.description,
      });

      if (error) {
        if (error.code === POSTGRES_UNIQUE_VIOLATION) {
          log.info({ userId, badgeType: candidate.type }, 'Badge already awarded by a concurrent attempt — skipping');
        } else {
          log.error({ err: error, userId, badgeType: candidate.type }, 'Failed to award badge');
        }
        continue;
      }

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
