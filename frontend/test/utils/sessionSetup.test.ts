import {
  type SetupSelection,
  buildCreateSessionRequest,
  togglePressure,
  validateSetup,
} from '@/utils/sessionSetup';

const base: SetupSelection = { scenario: 'skeptic', personaId: null, pressure: [], difficulty: null, goal: null, customGoal: '' };

describe('session setup', () => {
  it('caps pressure modifiers at two and allows deselecting', () => {
    let p = togglePressure([], 'rushed_impatient');
    p = togglePressure(p, 'competitor_mentioned');
    expect(togglePressure(p, 'compliance_concern')).toEqual(p);
    expect(togglePressure(p, 'rushed_impatient')).toEqual(['competitor_mentioned']);
  });

  it('requires a scenario and a custom goal text when goal is custom', () => {
    expect(validateSetup({ ...base, scenario: null })).toBeDefined();
    expect(validateSetup(base)).toBeUndefined();
    expect(validateSetup({ ...base, goal: 'custom', customGoal: ' ' })).toBeDefined();
    expect(validateSetup({ ...base, goal: 'custom', customGoal: 'a'.repeat(301) })).toBeDefined();
    expect(validateSetup({ ...base, goal: 'custom', customGoal: 'Get an intro' })).toBeUndefined();
  });

  it('omits everything left on automatic', () => {
    expect(buildCreateSessionRequest(base)).toEqual({ scenario_type: 'skeptic' });
  });

  it('builds a full request', () => {
    expect(
      buildCreateSessionRequest({
        scenario: 'cold_open',
        personaId: 'p1',
        pressure: ['rushed_impatient'],
        difficulty: 'advanced',
        goal: 'custom',
        customGoal: ' Get an intro ',
      }),
    ).toEqual({
      scenario_type: 'cold_open',
      persona_id: 'p1',
      pressure_modifiers: ['rushed_impatient'],
      difficulty_override: 'advanced',
      goal: { goal_type: 'custom', custom_text: 'Get an intro' },
    });
  });

  it('does not send custom_text for non-custom goals', () => {
    expect(buildCreateSessionRequest({ ...base, goal: 'get_reply', customGoal: 'ignored' }).goal).toEqual({ goal_type: 'get_reply' });
  });
});
