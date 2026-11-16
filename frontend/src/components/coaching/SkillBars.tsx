import React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import type { SixAxisScores } from '@/types/api';
import { SKILL_AXES, axisLabel } from '@/utils/labels';

export interface SkillBarsProps {
  scores: SixAxisScores;
  strongest?: string;
  weakest?: string;
}

/** Six-axis bar chart (0-100). Bars rather than a radar: easier to read and label for screen readers. */
export function SkillBars({ scores, strongest, weakest }: SkillBarsProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.md }}>
      {SKILL_AXES.map((axis) => {
        const value = Math.max(0, Math.min(100, scores[axis]));
        const tag = axis === strongest ? 'Strongest' : axis === weakest ? 'Focus area' : null;
        return (
          <View key={axis} style={{ gap: 4 }} accessible accessibilityLabel={`${axisLabel(axis)} ${Math.round(value)} out of 100${tag ? `, ${tag}` : ''}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption" color="secondary">
                {axisLabel(axis)}
                {tag ? `  ·  ${tag}` : ''}
              </Text>
              <Text variant="caption">{Math.round(value)}</Text>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.bg.elevated, overflow: 'hidden' }}>
              <View
                style={{
                  width: `${value}%`,
                  height: '100%',
                  borderRadius: 4,
                  backgroundColor:
                    axis === weakest ? theme.colors.signal.warning : axis === strongest ? theme.colors.signal.positive : theme.colors.accent.primary,
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}
