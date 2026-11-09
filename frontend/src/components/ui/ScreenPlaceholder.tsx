import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';

import { Text } from './Text';

/**
 * Marks a route that exists for navigation wiring (M0) but has no screen
 * implementation yet — later milestones replace these one at a time.
 * Never shipped as "done"; a visible, honest placeholder rather than a
 * silently blank or crashing route.
 */
export function ScreenPlaceholder({ title, milestone }: { title: string; milestone: string }) {
  const theme = useTheme();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.xl,
          gap: theme.spacing.sm,
        }}
      >
        <Text variant="title">{title}</Text>
        <Text variant="caption" color="tertiary">
          Built in {milestone}
        </Text>
      </View>
    </SafeAreaView>
  );
}
