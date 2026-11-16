import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateChart } from '@/components/coaching/StateChart';
import { AsyncBoundary, Button, Card, EmptyState, Text } from '@/components/ui';
import { useReplay } from '@/hooks/useDebrief';
import { useSession } from '@/hooks/useSessions';
import { useTheme } from '@/theme/ThemeProvider';
import type { MonologueSeverity, SessionMessage } from '@/types/api';

function BuyerTurn({ message }: { message: SessionMessage }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const accent: Record<MonologueSeverity, string> = {
    positive: theme.colors.signal.positive,
    neutral: theme.colors.content.tertiary,
    negative: theme.colors.signal.negative,
  };
  const severity = message.monologue_severity ?? 'neutral';
  const hasMonologue = !!message.internal_monologue;

  return (
    <View style={{ alignItems: 'flex-start', maxWidth: '88%', gap: 4 }}>
      <View style={{ backgroundColor: theme.colors.bg.elevated, borderRadius: theme.radius.card, borderBottomLeftRadius: 4, padding: theme.spacing.md }}>
        <Text variant="body">{message.content}</Text>
      </View>
      {hasMonologue ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Toggle what the buyer was thinking" onPress={() => setOpen((o) => !o)}>
          <Text variant="micro" color="secondary">
            {open ? 'Hide' : 'What they were thinking'}
          </Text>
        </Pressable>
      ) : null}
      {open && hasMonologue ? (
        <View style={{ borderLeftWidth: 3, borderLeftColor: accent[severity], paddingLeft: theme.spacing.sm, paddingVertical: 2 }}>
          <Text variant="caption" color="secondary" style={{ fontStyle: 'italic' }}>
            {message.internal_monologue}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Replay (architecture doc §7.9): only for completed sessions. */
export default function Replay() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession(id);
  const completed = session.data?.status === 'completed';
  const replay = useReplay(id, completed);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg, flexGrow: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title">Replay</Text>
          <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)/home'))} />
        </View>

        {session.data && !completed ? (
          <EmptyState title="Replay isn't available yet" description="You can replay a session once it has ended." />
        ) : (
          <AsyncBoundary
            isLoading={session.isPending || replay.isPending}
            isError={session.isError || replay.isError}
            error={session.error ?? replay.error}
            onRetry={() => {
              void session.refetch();
              void replay.refetch();
            }}
            skeletonVariant="row"
            skeletonCount={5}
          >
            {replay.data ? (
              <View style={{ gap: theme.spacing.lg }}>
                <Card style={{ gap: theme.spacing.sm }}>
                  <Text variant="caption" color="secondary">
                    How the buyer felt, turn by turn
                  </Text>
                  <StateChart snapshots={replay.data.heatmap} />
                </Card>
                <View style={{ gap: theme.spacing.md }}>
                  {replay.data.messages.map((m) =>
                    m.role === 'user' ? (
                      <View key={m.id} style={{ alignItems: 'flex-end' }}>
                        <View style={{ maxWidth: '82%', backgroundColor: theme.colors.accent.primary, borderRadius: theme.radius.card, borderBottomRightRadius: 4, padding: theme.spacing.md }}>
                          <Text variant="body" style={{ color: theme.colors.accent.onPrimary }}>
                            {m.content}
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <BuyerTurn key={m.id} message={m} />
                    ),
                  )}
                </View>
              </View>
            ) : null}
          </AsyncBoundary>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
