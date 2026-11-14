import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';

export interface SkillSparklineProps {
  /** Chronological (oldest first) values on the 0-100 score scale. */
  values: number[];
  height?: number;
}

/** Minimal trend line for the dashboard (§7.3). Fixed 0-100 domain so the slope is honest across workspaces. */
export function SkillSparkline({ values, height = 56 }: SkillSparklineProps) {
  const theme = useTheme();
  const width = 240;
  const pad = 4;
  if (values.length === 0) return null;

  const x = (i: number) => (values.length === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (values.length - 1));
  const y = (v: number) => {
    const clamped = Math.max(0, Math.min(100, v));
    return pad + (1 - clamped / 100) * (height - pad * 2);
  };
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const last = values.length - 1;

  return (
    <View accessibilityLabel={`Skill trend, latest ${Math.round(values[last])}`}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {values.length > 1 ? (
          <Polyline
            points={points}
            fill="none"
            stroke={theme.colors.accent.primary}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        <Circle cx={x(last)} cy={y(values[last])} r={3.5} fill={theme.colors.accent.primary} />
      </Svg>
    </View>
  );
}
