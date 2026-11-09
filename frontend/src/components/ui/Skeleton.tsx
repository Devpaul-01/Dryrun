import React, { useEffect, useState } from 'react';
import { Animated, View, type DimensionValue } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

export type SkeletonVariant = 'text' | 'row' | 'card';

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: DimensionValue;
  /** Number of stacked skeleton rows/lines to render. */
  count?: number;
}

const VARIANT_HEIGHT: Record<SkeletonVariant, number> = {
  text: 14,
  row: 56,
  card: 120,
};

/** Loading placeholder for anything with a known shape — session list rows, dashboard cards (architecture doc §4.3, §9.4). */
export function Skeleton({ variant = 'text', width = '100%', count = 1 }: SkeletonProps) {
  const theme = useTheme();
  const [opacity] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {Array.from({ length: count }).map((_, index) => (
        <Animated.View
          key={index}
          style={{
            width,
            height: VARIANT_HEIGHT[variant],
            borderRadius: variant === 'card' ? theme.radius.card : theme.radius.nested,
            backgroundColor: theme.colors.bg.elevated,
            opacity,
          }}
        />
      ))}
    </View>
  );
}
