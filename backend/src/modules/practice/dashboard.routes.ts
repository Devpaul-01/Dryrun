import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { supabaseAdmin } from '../../config/supabase';
import * as curriculumService from '../coaching/curriculum.service';
import * as workspaceService from '../workspace/workspace.service';
import { cached, cacheKeys, CACHE_TTL } from '../../config/cache';

const router = Router();

/**
 * Cached, short TTL, no explicit invalidation hook.
 *
 * This aggregate is fed by several independent async writers (session
 * completion, recomputeSkillTrend.worker, recomputeCurriculum.worker, and
 * every workspace member's own skill-trend recompute for the team-progress
 * branch). Wiring precise invalidation into all of those call sites would
 * mean touching four unrelated workers for a page where a few minutes of
 * staleness is inconsequential — a dashboard summary, not a live figure.
 * A short TTL (5 min) is the correct tradeoff: bounds staleness tightly
 * enough that "I just finished a session, why hasn't my dashboard updated"
 * support load stays negligible, without coupling every score-affecting
 * job to this route's cache key.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const workspaceId = req.workspace!.id;
    const role = req.workspace!.role;

    const result = await cached(
      cacheKeys.dashboard(workspaceId, userId),
      { ttlSeconds: CACHE_TTL.AGGREGATE_MINUTES_5 },
      async () => {
        const [{ data: lastSession }, { data: trend }, curriculum, teamProgress] = await Promise.all([
          supabaseAdmin()
            .from('practice_sessions')
            .select('id, title, scenario_type, status, completed_at')
            .eq('user_id', userId)
            .eq('workspace_id', workspaceId)
            .eq('status', 'completed')
            .order('completed_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabaseAdmin()
            .from('user_skill_trend')
            .select('*')
            .eq('user_id', userId)
            .eq('workspace_id', workspaceId)
            .order('period_start', { ascending: false })
            .limit(1)
            .maybeSingle(),
          curriculumService.getCurrentCurriculum(userId, workspaceId),
          role !== 'member' ? workspaceService.getAggregateTeamProgress(workspaceId) : Promise.resolve(null),
        ]);

        return {
          last_session: lastSession ?? null,
          skill_trend: trend ?? null,
          suggested_curriculum: curriculum,
          team_progress: teamProgress,
        };
      }
    );

    res.json(result);
  })
);

export default router;
