import type { CurriculumPlan, CurriculumSessionItem, ScenarioType } from '@/types/api';
import { axisLabel, scenarioLabel } from '@/utils/labels';

export function stepLabel(step: CurriculumSessionItem): string {
  switch (step.type) {
    case 'drill':
      return `Drill: ${axisLabel(step.focus_axis)}`;
    case 'full_scenario':
      return `Full scenario: ${axisLabel(step.focus_axis)}`;
    case 'spaced_repetition':
      return `Revisit: ${scenarioLabel(step.scenario_type)}`;
    default:
      return 'Practice session';
  }
}

/**
 * The scenario to preselect in the setup wizard for this plan. Only a
 * spaced_repetition step names a scenario; drill/full_scenario steps name a
 * skill axis, which does not map to a single scenario, so those leave the
 * wizard unfilled rather than guessing.
 */
export function suggestedScenario(plan: Pick<CurriculumPlan, 'sessions'> | null | undefined): ScenarioType | null {
  const step = plan?.sessions.find((s) => s.type === 'spaced_repetition');
  return step && step.type === 'spaced_repetition' ? step.scenario_type : null;
}
