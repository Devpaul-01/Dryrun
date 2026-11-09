import React from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Text } from './Text';

export type BadgeTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'accent';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
}

export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const theme = useTheme();

  const { bg, text } = (() => {
    switch (tone) {
      case 'positive':
        return { bg: `${theme.colors.signal.positive}26`, text: theme.colors.signal.positive };
      case 'warning':
        return { bg: `${theme.colors.signal.warning}26`, text: theme.colors.signal.warning };
      case 'negative':
        return { bg: `${theme.colors.signal.negative}26`, text: theme.colors.signal.negative };
      case 'accent':
        return { bg: `${theme.colors.accent.primary}26`, text: theme.colors.accent.primary };
      case 'neutral':
        return { bg: theme.colors.bg.elevated, text: theme.colors.content.secondary };
    }
  })();

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: bg,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
        borderRadius: theme.radius.pill,
      }}
    >
      <Text variant="micro" style={{ color: text }}>
        {label}
      </Text>
    </View>
  );
}
