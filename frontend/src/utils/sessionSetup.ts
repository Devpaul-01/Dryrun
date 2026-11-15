import type { DifficultyLevel, GoalType, PressureModifier, ScenarioType } from '@/types/api';
import type { CreateSessionRequest } from '@/types/requests';

export const MAX_PRESSURE = 2;
export const GOAL_CUSTOM_MAX = 300;

export const GOAL_OPTIONS: { type: GoalType; label: string }[] = [
  { type: 'book_meeting', label: 'Book a meeting' },
  { type: 'yes_no_budget', label: 'Get a yes/no on budget' },
  { type: 'uncover_objection', label: 'Uncover the real objection' },
  { type: 'get_reply', label: 'Get a reply' },
  { type: 'custom', label: 'Custom goal' },
];

export const DIFFICULTY_OPTIONS: DifficultyLevel[] = ['beginner', 'standard', 'advanced', 'expert'];

/** Toggle with a hard cap: at the limit an unselected modifier is simply not added (the UI also disables it). */
export function togglePressure(current: PressureModifier[], next: PressureModifier): PressureModifier[] {
  if (current.includes(next)) return current.filter((p) => p !== next);
  return current.length >= MAX_PRESSURE ? current : [...current, next];
}

export interface SetupSelection {
  scenario: ScenarioType | null;
  personaId: string | null; // null = let the backend build a buyer
  pressure: PressureModifier[];
  difficulty: DifficultyLevel | null; // null = automatic
  goal: GoalType | null;
  customGoal: string;
}

export function validateSetup(s: SetupSelection): string | undefined {
  if (!s.scenario) return 'Choose a scenario';
  if (s.goal === 'custom') {
    const n = s.customGoal.trim().length;
    if (n === 0) return 'Describe your custom goal';
    if (n > GOAL_CUSTOM_MAX) return `Custom goal must be ${GOAL_CUSTOM_MAX} characters or fewer`;
  }
  return undefined;
}

/** Builds the POST /sessions body, omitting anything left on automatic. */
export function buildCreateSessionRequest(s: SetupSelection): CreateSessionRequest {
  if (!s.scenario) throw new Error('scenario is required');
  return {
    scenario_type: s.scenario,
    ...(s.pressure.length ? { pressure_modifiers: s.pressure } : {}),
    ...(s.difficulty ? { difficulty_override: s.difficulty } : {}),
    ...(s.personaId ? { persona_id: s.personaId } : {}),
    ...(s.goal
      ? { goal: { goal_type: s.goal, ...(s.goal === 'custom' ? { custom_text: s.customGoal.trim() } : {}) } }
      : {}),
  };
}
