import {
  validateAudience,
  validateProduct,
  validateTone,
} from '@/utils/onboardingValidation';

describe('onboarding validation (mirrors the backend zod bounds)', () => {
  it('requires a non-blank product description and audience', () => {
    expect(validateProduct('')).toBeDefined();
    expect(validateProduct('   ')).toBeDefined();
    expect(validateAudience('')).toBeDefined();
    expect(validateProduct('A CRM for plumbers')).toBeUndefined();
  });

  it('accepts exactly 1000 characters and rejects 1001', () => {
    expect(validateProduct('a'.repeat(1000))).toBeUndefined();
    expect(validateProduct('a'.repeat(1001))).toMatch(/1 characters over/);
    expect(validateAudience('a'.repeat(1001))).toBeDefined();
  });

  it('measures the trimmed value, the same thing that gets sent', () => {
    expect(validateProduct('  ' + 'a'.repeat(1000) + '  ')).toBeUndefined();
  });

  it('treats tone as optional with a 300 character cap', () => {
    expect(validateTone('')).toBeUndefined();
    expect(validateTone('a'.repeat(300))).toBeUndefined();
    expect(validateTone('a'.repeat(301))).toBeDefined();
  });
});
