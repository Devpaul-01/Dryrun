import React from 'react';
import { View } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import type { StateSnapshot } from '@/types/api';

export interface StateChartProps {
  snapshots: StateSnapshot[];
  height?: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Interest / trust / confusion across the conversation (replay "heatmap" series), one line each on a fixed 0-100 axis. */
export function StateChart({ snapshots, height = 120 }: StateChartProps) {
  const theme = useTheme();
  const ordered = [...snapshots].sort((a, b) => a.sequence_index - b.sequence_index);
  const width = 300;
  const pad = 6;
  if (ordered.length < 2) {
    return (
      <Text variant="caption" color="secondary">
        Not enough turns to chart.
      </Text>
    );
  }
  const x = (i: number) => pad + (i * (width - pad * 2)) / (ordered.length - 1);
  const y = (v: number) => pad + (1 - clamp(v) / 100) * (height - pad * 2);
  const series = [
    { key: 'interest', label: 'Interest', color: theme.colors.meter.interest },
    { key: 'trust', label: 'Trust', color: theme.colors.meter.trust },
    { key: 'confusion', label: 'Confusion', color: theme.colors.meter.confusion },
  ] as const;

  return (
    <View style={{ gap: theme.spacing.sm }} accessible accessibilityLabel={`Chart of interest, trust and confusion over ${ordered.length - 1} turns`}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {[0, 50, 100].map((g) => (
          <Line key={g} x1={pad} x2={width - pad} y1={y(g)} y2={y(g)} stroke={theme.colors.border.subtle} strokeWidth={1} />
        ))}
        {series.map((s) => (
          <Polyline
            key={s.key}
            points={ordered.map((p, i) => `${x(i)},${y(p[s.key])}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
      </Svg>
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        {series.map((s) => (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
            <Text variant="micro" color="secondary">
              {s.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
