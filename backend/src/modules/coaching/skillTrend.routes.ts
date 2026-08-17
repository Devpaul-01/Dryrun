import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { supabaseAdmin } from '../../config/supabase';
import { cached, cacheKeys, CACHE_TTL } from '../../config/cache';

const router = Router();

router.get(
  '/skill-trend',
  asyncHandler(async (req, res) => {
    // Invalidated from modules/coaching/scoring.service.ts's
    // recomputeSkillTrendForUser() whenever a new trend snapshot is
    // written for this user+workspace pair.
    const trend = await cached(
      cacheKeys.skillTrend(req.user!.id, req.workspace!.id),
      { ttlSeconds: CACHE_TTL.LIST_MINUTES_2 },
      async () => {
        const { data } = await supabaseAdmin()
          .from('user_skill_trend')
          .select('*')
          .eq('user_id', req.user!.id)
          .eq('workspace_id', req.workspace!.id)
          .order('period_start', { ascending: false })
          .limit(12);
        return data ?? [];
      }
    );
    res.json({ trend });
  })
);

router.get(
  '/skill-trend/goals',
  asyncHandler(async (req, res) => {
    // FIX (audit finding H3): this query previously had no bound at all.
    // A naive .limit() here would be WRONG, not just incomplete — this
    // endpoint computes an ACHIEVEMENT RATE (achieved/total) aggregated
    // client-side across every goal a user has ever set, so truncating
    // the input set would silently change the meaning of the returned
    // rate (a "lifetime rate" quietly becoming a "rate over your most
    // recent N goals," with no signal to the caller that it happened).
    // The cap below is sized generously enough (2000 goals — years of
    // daily practice at this product's own cadence) to be a true safety
    // net against a pathological outlier, not a truncation any real
    // account would ever actually hit; a genuine unbounded-scale fix
    // would mean computing this via a database-side GROUP BY instead of
    // a client-side reduction, which is a larger query-shape change than
    // this pass's scope.
    const { data } = await supabaseAdmin()
      .from('session_goals')
      .select('goal_type, goal_achieved, practice_sessions!inner(user_id, workspace_id)')
      .eq('practice_sessions.user_id', req.user!.id)
      .eq('practice_sessions.workspace_id', req.workspace!.id)
      .limit(2000);

    const byType = new Map<string, { total: number; achieved: number }>();
    for (const row of data ?? []) {
      const entry = byType.get(row.goal_type) ?? { total: 0, achieved: 0 };
      entry.total += 1;
      if (row.goal_achieved) entry.achieved += 1;
      byType.set(row.goal_type, entry);
    }
    const rates = Array.from(byType.entries()).map(([goalType, v]) => ({
      goal_type: goalType,
      rate: v.total > 0 ? Math.round((v.achieved / v.total) * 100) : 0,
      total: v.total,
    }));
    res.json({ goal_achievement_rates: rates });
  })
);

export default router;
