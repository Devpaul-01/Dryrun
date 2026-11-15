import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text } from '@/components/ui';
import { finalLiveStateKey } from '@/hooks/useLiveSession';
import { useTheme } from '@/theme/ThemeProvider';
import type { LiveTurnState } from '@/types/api';

/** Ending transition (architecture doc §7.7): a deliberate beat before the debrief. Never blocks on the async debrief job. */
export default function Ending() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id, goal } = useLocalSearchParams<{ id: string; goal?: string }>();
  const achieved = goal === '1';
  const final = id ? queryClient.getQueryData<LiveTurnState>(finalLiveStateKey(id)) : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <View style={{ flex: 1, padding: theme.layout.screenPaddingPhone, justifyContent: 'center', gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title" color={achieved ? 'positive' : 'primary'}>
            {achieved ? 'Goal achieved' : 'Session complete'}
          </Text>
          <Text variant="body" color="secondary">
            {achieved
              ? 'You got what you came for. Your debrief is being prepared.'
              : 'Nice work finishing the conversation. Your debrief is being prepared.'}
          </Text>
        </View>

        {final ? (
          <Card style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <Stat label="Interest" value={final.interest} />
            <Stat label="Trust" value={final.trust} />
            <Stat label="Confusion" value={final.confusion} />
          </Card>
        ) : null}

        <Button
          label="See your debrief"
          variant="primary"
          fullWidth
          onPress={() => router.replace(`/(app)/session/${id}/debrief`)}
        />
      </View>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text variant="title">{Math.round(value)}</Text>
      <Text variant="caption" color="secondary">
        {label}
      </Text>
    </View>
  );
}
