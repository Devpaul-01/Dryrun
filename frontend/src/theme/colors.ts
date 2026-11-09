/**
 * Color tokens — light and dark both defined from day one (architecture
 * doc §9.2). Never hardcode hex in components; import from useTheme().
 *
 * Palette direction: DryRun is a rehearsal instrument, not a chat toy —
 * a dark "control room" canvas with a single confident amber accent and
 * three distinct, color-blind-safe meter hues (never reusing signal.*,
 * since interest/trust/confusion are tracked quantities, not good/bad
 * judgments).
 */

export interface ColorTokens {
  bg: {
    canvas: string;
    surface: string;
    elevated: string;
  };
  content: {
    primary: string;
    secondary: string;
    tertiary: string;
    inverse: string;
  };
  border: {
    subtle: string;
    strong: string;
  };
  accent: {
    primary: string;
    onPrimary: string;
  };
  signal: {
    positive: string;
    warning: string;
    negative: string;
  };
  meter: {
    interest: string;
    trust: string;
    confusion: string;
  };
}

export const darkColors: ColorTokens = {
  bg: {
    canvas: '#13151A',
    surface: '#1C1F26',
    elevated: '#262A33',
  },
  content: {
    primary: '#F5F6F8',
    secondary: '#9497A6',
    tertiary: '#5D6170',
    inverse: '#13151A',
  },
  border: {
    subtle: '#2E323C',
    strong: '#3C4150',
  },
  accent: {
    primary: '#FF8A3D',
    onPrimary: '#1A1206',
  },
  signal: {
    positive: '#5FD98C',
    warning: '#F6B860',
    negative: '#F2697A',
  },
  meter: {
    interest: '#4FD1C5',
    trust: '#8B9CF7',
    confusion: '#F6B860',
  },
};

export const lightColors: ColorTokens = {
  bg: {
    canvas: '#F7F7F9',
    surface: '#FFFFFF',
    elevated: '#FFFFFF',
  },
  content: {
    primary: '#15171C',
    secondary: '#5B5F6D',
    tertiary: '#8A8E9B',
    inverse: '#FFFFFF',
  },
  border: {
    subtle: '#E4E5EA',
    strong: '#CBCDD6',
  },
  accent: {
    primary: '#E06D1E',
    onPrimary: '#FFFFFF',
  },
  signal: {
    positive: '#1E9A58',
    warning: '#B6780B',
    negative: '#D13F55',
  },
  meter: {
    interest: '#0E9488',
    trust: '#5C6EDB',
    confusion: '#B6780B',
  },
};
