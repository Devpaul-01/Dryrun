import { stepLabel, suggestedScenario } from '@/utils/curriculum';

describe('curriculum helpers', () => {
  it('labels each step type, tolerating unknown types', () => {
    expect(stepLabel({ session_number: 1, type: 'drill', focus_axis: 'discovery' })).toBe('Drill: Discovery');
    expect(stepLabel({ session_number: 2, type: 'full_scenario', focus_axis: 'brevity' })).toBe('Full scenario: Brevity');
    expect(stepLabel({ session_number: 3, type: 'spaced_repetition', scenario_type: 'skeptic' })).toBe('Revisit: The Skeptic');
    expect(stepLabel({ session_number: 4, type: 'mystery' } as never)).toBe('Practice session');
  });

  it('prefills a scenario only from a spaced_repetition step', () => {
    expect(suggestedScenario(null)).toBeNull();
    expect(suggestedScenario({ sessions: [{ session_number: 1, type: 'drill', focus_axis: 'clarity' }] })).toBeNull();
    expect(
      suggestedScenario({
        sessions: [
          { session_number: 1, type: 'drill', focus_axis: 'clarity' },
          { session_number: 3, type: 'spaced_repetition', scenario_type: 'price_pushback' },
        ],
      }),
    ).toBe('price_pushback');
  });
});
