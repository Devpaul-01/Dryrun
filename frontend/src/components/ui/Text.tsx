import React from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import type { TypographyToken } from '@/theme/typography';

export interface TextProps extends RNTextProps {
  variant?: TypographyToken;
  color?: 'primary' | 'secondary' | 'tertiary' | 'inverse' | 'accent' | 'positive' | 'warning' | 'negative';
}

/**
 * The only text component components/ should use directly — applies a
 * typography token and a semantic color token, so no component hardcodes
 * a font size or a hex color (architecture doc §9.1, §9.2).
 */
export function Text({ variant = 'body', color = 'primary', style, ...rest }: TextProps) {
  const theme = useTheme();

  const colorValue = (() => {
    switch (color) {
      case 'primary':
        return theme.colors.content.primary;
      case 'secondary':
        return theme.colors.content.secondary;
      case 'tertiary':
        return theme.colors.content.tertiary;
      case 'inverse':
        return theme.colors.content.inverse;
      case 'accent':
        return theme.colors.accent.primary;
      case 'positive':
        return theme.colors.signal.positive;
      case 'warning':
        return theme.colors.signal.warning;
      case 'negative':
        return theme.colors.signal.negative;
    }
  })();

  return (
    <RNText style={[theme.typography[variant], { color: colorValue }, style]} {...rest} />
  );
}
