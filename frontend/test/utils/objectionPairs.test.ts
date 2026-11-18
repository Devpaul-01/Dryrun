jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
import { objectionPairs } from '@/components/coaching/PlaybookView';

describe('objectionPairs', () => {
  it('handles structured pairs and plain strings', () => {
    expect(objectionPairs([{ objection: 'Too pricey', response: 'Compare ROI' }])).toEqual([{ objection: 'Too pricey', response: 'Compare ROI' }]);
    expect(objectionPairs(['Just reframe it'])).toEqual([{ objection: null, response: 'Just reframe it' }]);
  });
});
