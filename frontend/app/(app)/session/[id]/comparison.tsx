import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Card, Skeleton, Text } from '@/components/ui';
import { useComparison } from '@/hooks/useDebrief';
import { useSession } from '@/hooks/useSessions';
import { useTheme } from '@/theme/ThemeProvider';
import type { SessionComparison } from '@/types/api';
import { SKILL_AXES, axisLabel, formatDelta } from '@/utils/labels';

function GoalBadge({ label, achieved }: { label: string; achieved: boolean | null }) {
  return <Badge label={`${label}: ${achieved ? 'goal achieved' : achieved === false ? 'goal not reached' : 'no goal'}`} tone={achieved ? 'positive' : 'neutral'} />;
}

function AxisRow({ axis, data }: { axis: (typeof SKILL_AXES)[number]; data: SessionComparison }) {
  const theme = useTheme();
  const before = Math.round(data.original_scores[axis]);
  const after = Math.round(data.retry_scores[axis]);
  const delta = data.deltas[axis] ?? after - before;
  const color = delta > 0 ? theme.colors.signal.positive : delta < 0 ? theme.colors.signal.negative : theme.colors.content.tertiary;

  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={`${axisLabel(axis)}: first attempt ${before}, retry ${after}, change ${formatDelta(delta)}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="caption" color="secondary">
          {axisLabel(axis)}
        </Text>
        <Text variant="caption" style={{ color, fontWeight: '700' }}>
          {formatDelta(delta)}
        </Text>
      </View>
      {[
        { value: before, fill: theme.colors.content.tertiary, tag: 'First' },
        { value: after, fill: theme.colors.accent.primary, tag: 'Retry' },
      ].map((bar) => (
        <View key={bar.tag} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Text variant="micro" color="tertiary" style={{ width: 36 }}>
            {bar.tag}
          </Text>
          <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.colors.bg.elevated, overflow: 'hidden' }}>
            <View style={{ width: `${Math.max(0, Math.min(100, bar.value))}%`, height: '100%', backgroundColor: bar.fill, borderRadius: 4 }} />
          </View>
          <Text variant="micro" style={{ width: 24, textAlign: 'right' }}>
            {bar.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Retry comparison (architecture doc §7.10). The id in the route is the RETRY session's id. */
export default function Comparison() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession(id);
  const comparison = useComparison(id);
  const data = comparison.data;
  const notARetry = session.data && !session.data.retry_of_session_id;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title">Before &amp; after</Text>
          <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)/home'))} />
        </View>

        {notARetry ? (
          <Card>
            <Text variant="body" color="secondary">
              This session isn&apos;t a retry, so there is nothing to compare it with.
            </Text>
          </Card>
        ) : data ? (
          <View style={{ gap: theme.spacing.lg }}>
            <Card style={{ gap: theme.spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text variant="heading">Overall</Text>
                <Text variant="title" style={{ color: data.deltas.composite_score >= 0 ? theme.colors.signal.positive : theme.colors.signal.negative }}>
                  {formatDelta(data.deltas.composite_score)}
                </Text>
              </View>
              <Text variant="body">{data.summary}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
                <GoalBadge label="First" achieved={data.original_goal_achieved} />
                <GoalBadge label="Retry" achieved={data.retry_goal_achieved} />
              </View>
            </Card>
            <Card style={{ gap: theme.spacing.lg }}>
              {SKILL_AXES.map((axis) => (
                <AxisRow key={axis} axis={axis} data={data} />
              ))}
            </Card>
          </View>
        ) : (
          <Card style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">{comparison.timedOut ? 'Still scoring' : 'Comparing your attempts…'}</Text>
            <Text variant="body" color="secondary">
              {comparison.timedOut
                ? 'Both sessions need to finish scoring first, which is taking longer than usual. Check back shortly.'
                : 'We compare once both sessions are scored. This usually takes under a minute.'}
            </Text>
            {comparison.timedOut ? <Button label="Check again" variant="secondary" onPress={comparison.checkAgain} /> : <Skeleton variant="text" count={3} />}
            {comparison.isError ? (
              <Text variant="caption" color="negative">
                Could not load the comparison.
              </Text>
            ) : null}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
