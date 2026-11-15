import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text } from '@/components/ui';
import { useSession } from '@/hooks/useSessions';
import { useLastSessionStore } from '@/stores/lastSessionStore';
import { useTheme } from '@/theme/ThemeProvider';
import { scenarioLabel } from '@/utils/labels';

/** Practice tab (architecture doc §7.4 entry): start a session, resume one in progress, or manage buyers. */
export default function Practice() {
  const theme = useTheme();
  const router = useRouter();
  const pointer = useLastSessionStore((s) => s.lastActiveSessionId);
  const active = useSession(pointer ?? undefined);
  const resumable = active.data && active.data.status === 'active' ? active.data : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg }}>
        <Text variant="title">Practice</Text>

        {resumable ? (
          <Card style={{ gap: theme.spacing.sm, borderColor: theme.colors.accent.primary }}>
            <Text variant="caption" color="secondary">
              In progress
            </Text>
            <Text variant="heading">{resumable.persona_snapshot?.name ?? scenarioLabel(resumable.scenario_type)}</Text>
            <Button label="Resume session" variant="primary" fullWidth onPress={() => router.push(`/(app)/session/${resumable.id}/live`)} />
          </Card>
        ) : null}

        <Card style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Start a new session</Text>
          <Text variant="body" color="secondary">
            Pick a scenario and a buyer, add some pressure, and get scored on how you handle it.
          </Text>
          <Button label="New session" variant="primary" fullWidth onPress={() => router.push('/(app)/session/new')} />
        </Card>

        <View style={{ gap: theme.spacing.sm }}>
          <Button label="Manage buyers" variant="secondary" fullWidth onPress={() => router.push('/(app)/persona')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
