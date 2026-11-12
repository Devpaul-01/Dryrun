import { Link, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Entry point (architecture doc §7.1): value-prop hero, a no-auth "Try the
 * demo" CTA, and the path into signup/login. Demo flow itself is §7.17 /
 * M8 scope — the CTA routes there once that screen exists.
 */
export default function Welcome() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: theme.layout.screenPaddingPhone,
          justifyContent: 'space-between',
        }}
      >
        <View style={{ gap: theme.spacing.lg, marginTop: theme.spacing.xxxl }}>
          <Text variant="display">DryRun</Text>
          <Text variant="heading" color="secondary">
            Rehearse the hard conversation before it happens.
          </Text>
          <Text variant="body" color="secondary">
            Practice sales calls, tough feedback, and high-stakes pitches
            against an AI buyer that pushes back like a real one — then see
            exactly what worked.
          </Text>
        </View>

        <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xl }}>
          <Button
            label="Try the demo"
            variant="secondary"
            fullWidth
            onPress={() => router.push('/(public)/demo/start')}
          />
          <Button
            label="Create account"
            variant="primary"
            fullWidth
            onPress={() => router.push('/(public)/signup')}
          />
          <Link href="/(public)/login" asChild>
            <Button label="Log in" variant="ghost" fullWidth />
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
