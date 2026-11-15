import React, { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

/** Seconds before the label switches to the "taking longer" wording (architecture doc §8). */
export const SLOW_REPLY_AFTER_MS = 4000;

/** Buyer-side three-dot bubble with a duration-aware label, so a slow turn never reads as frozen. */
export function TypingIndicator({ buyerName }: { buyerName?: string }) {
  const theme = useTheme();
  const [dots] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.3)));
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const loops = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(v, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 350, useNativeDriver: true }),
          Animated.delay((2 - i) * 160),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    const timer = setTimeout(() => setSlow(true), SLOW_REPLY_AFTER_MS);
    return () => {
      loops.forEach((l) => l.stop());
      clearTimeout(timer);
    };
  }, [dots]);

  const who = buyerName ?? 'The buyer';
  return (
    <View accessibilityLiveRegion="polite" style={{ alignItems: 'flex-start', gap: 2 }}>
      <Text variant="micro" color="tertiary" style={{ marginLeft: theme.spacing.xs }}>
        {slow ? `${who} is thinking it over…` : `${who} is replying…`}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          gap: 6,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          borderRadius: theme.radius.card,
          borderBottomLeftRadius: 4,
          backgroundColor: theme.colors.bg.elevated,
        }}
      >
        {dots.map((v, i) => (
          <Animated.View
            key={i}
            style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.content.secondary, opacity: v }}
          />
        ))}
      </View>
    </View>
  );
}
