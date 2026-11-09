/**
 * Spacing scale and layout constants (architecture doc §9.3).
 * 4px base unit.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export type SpacingToken = keyof typeof spacing;

export const radius = {
  /** Primary cards. */
  card: 16,
  /** Nested/secondary elements. */
  nested: 12,
  /** Chips, badges — fully round. */
  pill: 999,
} as const;

export const layout = {
  screenPaddingPhone: 16,
  screenPaddingTablet: 24,
  /** Max content width on larger screens — chat bubbles etc. don't stretch edge-to-edge. */
  maxContentWidth: 560,
  tabletBreakpoint: 768,
} as const;
