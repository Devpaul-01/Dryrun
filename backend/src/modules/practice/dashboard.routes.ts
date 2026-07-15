import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { supabaseAdmin } from '../../config/supabase';
import * as curriculumService from '../coaching/curriculum.service';
import * as workspaceService from '../workspace/workspace.service';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const workspaceId = req.workspace!.id;

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
      req.workspace!.role !== 'member' ? workspaceService.getAggregateTeamProgress(workspaceId) : Promise.resolve(null),
    ]);

    res.json({
      last_session: lastSession ?? null,
      skill_trend: trend ?? null,
      suggested_curriculum: curriculum,
      team_progress: teamProgress,
    });
  })
);

export default router;
