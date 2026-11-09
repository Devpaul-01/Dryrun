import React from 'react';
import { View, type ViewProps } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

export interface CardProps extends ViewProps {
  /** Nested/secondary card inside another card gets the smaller radius (architecture doc §9.3). */
  nested?: boolean;
  padded?: boolean;
}

export function Card({ nested = false, padded = true, style, children, ...rest }: CardProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.bg.surface,
          borderRadius: nested ? theme.radius.nested : theme.radius.card,
          borderWidth: 1,
          borderColor: theme.colors.border.subtle,
          padding: padded ? theme.spacing.lg : 0,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
