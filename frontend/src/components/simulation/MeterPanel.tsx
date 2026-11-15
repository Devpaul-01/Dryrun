import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import type { LiveTurnState } from '@/types/api';
import { momentumDirection } from '@/utils/liveSession';

const clamp = (n: number) => Math.max(0, Math.min(100, n));

function Bar({ label, value, color, thin = false }: { label: string; value: number; color: string; thin?: boolean }) {
  const theme = useTheme();
  const progress = useSharedValue(clamp(value));

  useEffect(() => {
    // Spring on every update: the moving number is the proof that a specific line landed (§8).
    progress.value = withSpring(clamp(value), { damping: 16, stiffness: 120 });
  }, [value, progress]);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value}%` }));

  return (
    <View style={{ gap: 4 }} accessible accessibilityLabel={`${label} ${Math.round(value)} out of 100`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant={thin ? 'micro' : 'caption'} color="secondary">
          {label}
        </Text>
        <Text variant={thin ? 'micro' : 'caption'} color="secondary">
          {Math.round(value)}
        </Text>
      </View>
      <View style={{ height: thin ? 4 : 8, borderRadius: 4, backgroundColor: theme.colors.bg.elevated, overflow: 'hidden' }}>
        <Animated.View style={[{ height: '100%', borderRadius: 4, backgroundColor: color }, fill]} />
      </View>
    </View>
  );
}

const MOMENTUM = {
  up: { glyph: '↑', label: 'Heating up' },
  flat: { glyph: '→', label: 'Holding steady' },
  down: { glyph: '↓', label: 'Cooling off' },
} as const;

export interface MeterPanelProps {
  live: LiveTurnState;
  /** False until a turn has produced a real reading in this session view. */
  hasReading: boolean;
}

/** Interest and trust are the headline bars, confusion a thin tertiary one; intent/objection are revealed on tap. */
export function MeterPanel({ live, hasReading }: MeterPanelProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const dir = MOMENTUM[momentumDirection(live.momentum)];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Live buyer meters. Tap for more detail"
      onPress={() => setExpanded((e) => !e)}
      style={{
        backgroundColor: theme.colors.bg.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.subtle,
        paddingHorizontal: theme.layout.screenPaddingPhone,
        paddingVertical: theme.spacing.md,
        gap: theme.spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', gap: theme.spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Bar label="Interest" value={live.interest} color={theme.colors.meter.interest} />
        </View>
        <View style={{ flex: 1 }}>
          <Bar label="Trust" value={live.trust} color={theme.colors.meter.trust} />
        </View>
      </View>
      <Bar label="Confusion" value={live.confusion} color={theme.colors.meter.confusion} thin />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="micro" color="secondary">
          {dir.glyph} {dir.label}
        </Text>
        <Text variant="micro" color="tertiary">
          {hasReading ? (expanded ? 'Hide detail' : 'Tap for detail') : 'Updates after your first message'}
        </Text>
      </View>
      {expanded ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Bar label="Buying intent (this turn)" value={live.buying_intent} color={theme.colors.accent.primary} thin />
          <Bar label="Objection likelihood (this turn)" value={live.objection_likelihood} color={theme.colors.signal.warning} thin />
        </View>
      ) : null}
    </Pressable>
  );
}
