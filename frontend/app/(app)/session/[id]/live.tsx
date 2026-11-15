import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, type ScrollViewInstance, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AsyncBoundary, Button, Card, Chip, Text } from '@/components/ui';
import { ChatBubble } from '@/components/simulation/ChatBubble';
import { Composer } from '@/components/simulation/Composer';
import { MeterPanel } from '@/components/simulation/MeterPanel';
import { TypingIndicator } from '@/components/simulation/TypingIndicator';
import { useLiveSession } from '@/hooks/useLiveSession';
import { useSession } from '@/hooks/useSessions';
import { useTheme } from '@/theme/ThemeProvider';
import { pressureLabel, scenarioLabel } from '@/utils/labels';
import { canSend } from '@/utils/liveSession';

/** Delay between "goal achieved" confirmation and the ending screen (architecture doc §8: ~1.5s). */
const GOAL_TRANSITION_MS = 1500;

function confirmEnd(onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm('End this session and get your debrief?')) onConfirm();
    return;
  }
  Alert.alert('End this session?', 'You will get your debrief next.', [
    { text: 'Keep practicing', style: 'cancel' },
    { text: 'End session', style: 'destructive', onPress: onConfirm },
  ]);
}

/** Live simulation (architecture doc §7.5 and §8). */
export default function LiveSession() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionQuery = useSession(id);
  const session = sessionQuery.data;
  const live = useLiveSession(session);
  const { state } = live;
  const scroller = useRef<ScrollViewInstance>(null);

  const buyerName = session?.persona_snapshot?.name;

  // Already finished (ended elsewhere, or reopened via a stale pointer): go straight to the debrief (§4.5).
  useEffect(() => {
    if (session && session.status === 'completed' && !state.goalAchieved) {
      router.replace(`/(app)/session/${session.id}/debrief`);
    }
  }, [session, state.goalAchieved, router]);

  // Goal achieved: brief celebration, then auto-navigate. Input is already locked by `state.ended`.
  useEffect(() => {
    if (!state.goalAchieved || !id) return;
    const t = setTimeout(() => router.replace(`/(app)/session/${id}/ending?goal=1`), GOAL_TRANSITION_MS);
    return () => clearTimeout(t);
  }, [state.goalAchieved, id, router]);

  useEffect(() => {
    scroller.current?.scrollToEnd({ animated: true });
  }, [state.items.length, state.awaitingReply, state.naturalEnding]);

  async function handleEnd() {
    if (await live.end()) router.replace(`/(app)/session/${id}/ending`);
  }

  const pressure = session?.pressure_modifiers ?? [];
  const sendable = canSend(state);
  const disabledReason = state.ended
    ? state.goalAchieved
      ? 'Goal achieved — wrapping up…'
      : 'This session has ended.'
    : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }} edges={['top']}>
      <AsyncBoundary
        isLoading={sessionQuery.isPending || live.historyStatus === 'loading'}
        isError={sessionQuery.isError || live.historyStatus === 'error'}
        error={sessionQuery.error}
        onRetry={() => {
          void sessionQuery.refetch();
          void live.reloadHistory();
        }}
        skeletonVariant="row"
        skeletonCount={5}
      >
        <View style={{ flex: 1 }}>
          <View
            style={{
              paddingHorizontal: theme.layout.screenPaddingPhone,
              paddingVertical: theme.spacing.sm,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: theme.spacing.sm,
            }}
          >
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <Text variant="heading" numberOfLines={1}>
                {buyerName ?? 'Practice session'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
                {session ? <Chip label={scenarioLabel(session.scenario_type)} /> : null}
                {pressure.map((p) => (
                  <Chip key={p} label={pressureLabel(p)} />
                ))}
              </View>
            </View>
            <Button
              label="End"
              variant="secondary"
              disabled={state.ended || state.awaitingReply}
              onPress={() => confirmEnd(() => void handleEnd())}
            />
          </View>

          <MeterPanel live={state.live} hasReading={state.hasLiveReading} />

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
              ref={scroller}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.md, flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
            >
              {state.items.length === 0 ? (
                <Text variant="body" color="secondary" style={{ textAlign: 'center', marginTop: theme.spacing.xl }}>
                  {buyerName ?? 'The buyer'} is waiting. Send your opening message to begin.
                </Text>
              ) : null}
              {state.items.map((item) => (
                <ChatBubble key={item.localId} item={item} buyerName={buyerName} onRetry={live.retry} />
              ))}
              {state.awaitingReply ? <TypingIndicator buyerName={buyerName} /> : null}
            </ScrollView>

            {state.goalAchieved ? (
              <Card
                accessibilityLiveRegion="polite"
                style={{ marginHorizontal: theme.layout.screenPaddingPhone, borderColor: theme.colors.signal.positive, gap: theme.spacing.xs }}
              >
                <Text variant="heading" color="positive">
                  Goal achieved
                </Text>
                <Text variant="caption" color="secondary">
                  Nice work — taking you to the wrap-up.
                </Text>
              </Card>
            ) : null}

            {state.naturalEnding && !state.ended ? (
              <Card
                style={{ marginHorizontal: theme.layout.screenPaddingPhone, marginBottom: theme.spacing.sm, gap: theme.spacing.sm }}
              >
                <Text variant="body">This conversation feels like it&apos;s winding down.</Text>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  <Button label="Wrap it up" variant="primary" onPress={() => confirmEnd(() => void handleEnd())} />
                  <Button label="Keep going" variant="secondary" onPress={live.keepGoing} />
                </View>
              </Card>
            ) : null}

            {live.endError ? (
              <Text variant="caption" color="negative" style={{ textAlign: 'center', padding: theme.spacing.sm }}>
                {live.endError}
              </Text>
            ) : null}

            <Composer onSend={live.send} disabled={!sendable} disabledReason={disabledReason} />
          </KeyboardAvoidingView>
        </View>
      </AsyncBoundary>
    </SafeAreaView>
  );
}
