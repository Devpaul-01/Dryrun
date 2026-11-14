import { axisLabel, scenarioLabel } from '@/utils/labels';

describe('labels', () => {
  it('maps known keys', () => {
    expect(scenarioLabel('price_pushback')).toBe('Price Pushback');
    expect(axisLabel('cta_strength')).toBe('Call to action');
  });
  it('falls back to a humanized key for unknown values', () => {
    expect(scenarioLabel('new_thing')).toBe('New thing');
    expect(axisLabel('')).toBe('Unknown');
  });
});
