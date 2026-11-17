import { useRouter } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CurriculumCard } from '@/components/coaching/CurriculumCard';
import { SkillSparkline } from '@/components/coaching/SkillSparkline';
import { Card, EmptyState, Skeleton, Text } from '@/components/ui';
import { useSkillTrend } from '@/hooks/useDashboard';
import { useBadges, useCurriculum, useDismissCurriculum, useGoalRates } from '@/hooks/useProgress';
import { useTheme } from '@/theme/ThemeProvider';
import { suggestedScenario } from '@/utils/curriculum';
import { goalLabel } from '@/utils/labels';

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useTheme();
  return (
    <Card style={{ gap: theme.spacing.xs }}>
      <Text variant="caption" color="negative">
        {message}
      </Text>
      <Text variant="caption" color="secondary" onPress={onRetry} accessibilityRole="button">
        Tap to retry
      </Text>
    </Card>
  );
}

/** Progress (architecture doc §7.12): skill trend, goal rates, curriculum, badges. Each section loads and fails independently. */
export default function Progress() {
  const theme = useTheme();
  const router = useRouter();
  const trend = useSkillTrend();
  const goals = useGoalRates();
  const curriculum = useCurriculum();
  const badges = useBadges();
  const dismiss = useDismissCurriculum();

  const series = (trend.data ?? []).map((p) => p.composite_avg).reverse();
  const refreshing = trend.isRefetching || goals.isRefetching || curriculum.isRefetching || badges.isRefetching;
  const plan = curriculum.data;
  const nothingYet = !trend.isPending && series.length === 0 && !goals.isPending && (goals.data ?? []).length === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void trend.refetch();
              void goals.refetch();
              void curriculum.refetch();
              void badges.refetch();
            }}
          />
        }
      >
        <Text variant="title">Progress</Text>

        {nothingYet ? (
          <EmptyState
            title="Your progress will show up here"
            description="Finish a practice session and we'll start tracking your scores, goals and streaks."
            actionLabel="Start a session"
            onAction={() => router.push('/(app)/session/new')}
          />
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Skill trend</Text>
          {trend.isPending ? (
            <Skeleton variant="card" />
          ) : trend.isError ? (
            <SectionError message="Could not load your skill trend." onRetry={() => void trend.refetch()} />
          ) : series.length > 0 ? (
            <Card style={{ gap: theme.spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text variant="caption" color="secondary">
                  Average score, last {series.length} period{series.length === 1 ? '' : 's'}
                </Text>
                <Text variant="title">{Math.round(series[series.length - 1])}</Text>
              </View>
              <SkillSparkline values={series} height={96} />
            </Card>
          ) : null}
        </View>

        {plan === undefined || plan ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">Your plan</Text>
            {curriculum.isPending ? (
              <Skeleton variant="card" />
            ) : curriculum.isError ? (
              <SectionError message="Could not load your plan." onRetry={() => void curriculum.refetch()} />
            ) : plan ? (
              <CurriculumCard
                plan={plan}
                dismissing={dismiss.isPending}
                onDismiss={() => dismiss.mutate(plan.id)}
                onStart={() => {
                  const scenario = suggestedScenario(plan);
                  router.push(scenario ? { pathname: '/(app)/session/new', params: { scenario } } : '/(app)/session/new');
                }}
              />
            ) : null}
          </View>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Goal success rate</Text>
          {goals.isPending ? (
            <Skeleton variant="card" />
          ) : goals.isError ? (
            <SectionError message="Could not load goal rates." onRetry={() => void goals.refetch()} />
          ) : (goals.data ?? []).length === 0 ? (
            <Text variant="body" color="secondary">
              Set a goal when you start a session to track how often you hit it.
            </Text>
          ) : (
            <Card style={{ gap: theme.spacing.md }}>
              {(goals.data ?? []).map((g) => (
                <View key={g.goal_type} style={{ gap: 4 }} accessible accessibilityLabel={`${goalLabel(g.goal_type)}: ${g.rate} percent over ${g.total} sessions`}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text variant="caption" color="secondary">
                      {goalLabel(g.goal_type)}
                    </Text>
                    <Text variant="caption">
                      {g.rate}% · {g.total} session{g.total === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.bg.elevated, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.max(0, Math.min(100, g.rate))}%`, height: '100%', borderRadius: 4, backgroundColor: theme.colors.signal.positive }} />
                  </View>
                </View>
              ))}
            </Card>
          )}
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Badges</Text>
          {badges.isPending ? (
            <Skeleton variant="row" />
          ) : badges.isError ? (
            <SectionError message="Could not load badges." onRetry={() => void badges.refetch()} />
          ) : (badges.data ?? []).length === 0 ? (
            <Text variant="body" color="secondary">
              Complete your first session to earn your first badge.
            </Text>
          ) : (
            <View style={{ gap: theme.spacing.sm }}>
              {(badges.data ?? []).map((b) => (
                <Card key={b.id} style={{ gap: 2 }}>
                  <Text variant="heading">{b.badge_label}</Text>
                  {b.badge_description ? (
                    <Text variant="caption" color="secondary">
                      {b.badge_description}
                    </Text>
                  ) : null}
                </Card>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
