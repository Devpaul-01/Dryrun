import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

/** Last-resort screen for a render crash: reassure, offer a retry. Safe to render with no data. */
export function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas, justifyContent: 'center' }}>
      <View style={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.md }}>
        <Text variant="title">Something went wrong</Text>
        <Text variant="body" color="secondary">
          The app hit an unexpected problem. Your practice sessions and data are safe. Try again, and if it keeps happening, restart the app.
        </Text>
        <Button label="Try again" variant="primary" fullWidth onPress={onRetry} />
      </View>
    </SafeAreaView>
  );
}
