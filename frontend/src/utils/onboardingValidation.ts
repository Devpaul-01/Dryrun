/**
 * Instant Setup bounds, mirroring backend practice/onboarding.routes.ts's
 * zod schema (product_description / target_audience 1-1000, tone ≤300).
 */
export const PRODUCT_MAX = 1000;
export const AUDIENCE_MAX = 1000;
export const TONE_MAX = 300;

function validateRequired(value: string, max: number, label: string): string | undefined {
  const length = value.trim().length;
  if (length === 0) return `${label} is required`;
  if (length > max) return `${label} is ${length - max} characters over the ${max} limit`;
  return undefined;
}

export const validateProduct = (value: string) =>
  validateRequired(value, PRODUCT_MAX, 'Product description');
export const validateAudience = (value: string) =>
  validateRequired(value, AUDIENCE_MAX, 'Target audience');

export function validateTone(value: string): string | undefined {
  const length = value.trim().length;
  return length > TONE_MAX
    ? `Tone preference is ${length - TONE_MAX} characters over the ${TONE_MAX} limit`
    : undefined;
}
