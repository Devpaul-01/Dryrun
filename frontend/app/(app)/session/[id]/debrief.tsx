import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SkillBars } from '@/components/coaching/SkillBars';
import { Badge, Button, Card, Skeleton, Text } from '@/components/ui';
import { useDebrief, useRetrySession, useSessionResult } from '@/hooks/useDebrief';
import { useSession } from '@/hooks/useSessions';
import { useTheme } from '@/theme/ThemeProvider';
import { isFeatureGateException, isApiException } from '@/types/errors';
import { axisLabel, scenarioLabel } from '@/utils/labels';

function InsightCard({ title, body, tone }: { title: string; body: string; tone?: 'positive' | 'warning' }) {
  const theme = useTheme();
  return (
    <Card style={{ gap: theme.spacing.xs }}>
      <Text variant="caption" color={tone ?? 'secondary'}>
        {title}
      </Text>
      <Text variant="body">{body}</Text>
    </Card>
  );
}

/** Debrief (architecture doc §7.8): the honest read. The scoring/debrief jobs are async, so this polls with explicit pending messaging. */
export default function Debrief() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession(id);
  const debrief = useDebrief(id);
  const result = useSessionResult(id);
  const retry = useRetrySession();

  const scores = result.data?.skill_scores ?? null;
  const goal = result.data?.goal ?? null;
  const retryOf = session.data?.retry_of_session_id;
  const pending = !debrief.ready || !scores;
  const timedOut = (debrief.timedOut || result.timedOut) && pending;

  const retryError = retry.isError
    ? isFeatureGateException(retry.error)
      ? retry.error.body.message
      : isApiException(retry.error)
        ? (retry.error.body?.message ?? 'Could not start a retry.')
        : 'Could not start a retry. Check your connection.'
    : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title">Debrief</Text>
          <Button label="Done" variant="ghost" onPress={() => router.replace('/(app)/(tabs)/home')} />
        </View>

        {session.data ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, alignItems: 'center' }}>
            <Badge label={scenarioLabel(session.data.scenario_type)} />
            {goal ? (
              <Badge
                label={goal.goal_achieved ? 'Goal achieved' : goal.goal_achieved === false ? 'Goal not reached' : 'Goal set'}
                tone={goal.goal_achieved ? 'positive' : 'neutral'}
              />
            ) : null}
          </View>
        ) : null}

        {debrief.ready && debrief.data ? (
          <View style={{ gap: theme.spacing.md }}>
            <InsightCard title="What worked" body={debrief.data.strength} tone="positive" />
            <InsightCard title="What to improve" body={debrief.data.improvement} tone="warning" />
            <InsightCard title="Coachable moment" body={debrief.data.coachable_moment} />
            {debrief.data.goal_reference ? <InsightCard title="On your goal" body={debrief.data.goal_reference} /> : null}
          </View>
        ) : (
          <Card style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">{timedOut ? 'Still working on it' : 'Coaching your results…'}</Text>
            <Text variant="body" color="secondary">
              {timedOut
                ? 'Scoring is taking longer than usual. It keeps running in the background — check back in a minute.'
                : 'Your debrief and scores are prepared in the background. This usually takes 10–20 seconds.'}
            </Text>
            {timedOut ? (
              <Button
                label="Check again"
                variant="secondary"
                onPress={() => {
                  debrief.checkAgain();
                  result.checkAgain();
                }}
              />
            ) : (
              <Skeleton variant="text" count={3} />
            )}
          </Card>
        )}

        {scores ? (
          <Card style={{ gap: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text variant="heading">Skill scores</Text>
              <Text variant="title">{Math.round(scores.composite_score)}</Text>
            </View>
            <SkillBars scores={scores} strongest={scores.strongest_axis} weakest={scores.weakest_axis} />
            <Text variant="caption" color="secondary">
              Strongest: {axisLabel(scores.strongest_axis)} · Focus next on {axisLabel(scores.weakest_axis)}
            </Text>
          </Card>
        ) : !timedOut && debrief.ready ? (
          <Card>
            <Skeleton variant="card" />
          </Card>
        ) : null}

        {retryError ? (
          <Card style={{ borderColor: theme.colors.signal.negative }}>
            <Text variant="caption" color="negative">
              {retryError}
            </Text>
          </Card>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          {retryOf ? (
            <Button label="Compare with your first attempt" variant="primary" fullWidth onPress={() => router.push(`/(app)/session/${id}/comparison`)} />
          ) : null}
          <Button
            label="Retry this scenario"
            variant={retryOf ? 'secondary' : 'primary'}
            fullWidth
            loading={retry.isPending}
            onPress={() =>
              retry.mutate(id, { onSuccess: (s) => router.replace(`/(app)/session/${s.id}/live`) })
            }
          />
          <Button label="See the full replay" variant="secondary" fullWidth onPress={() => router.push(`/(app)/session/${id}/replay`)} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
