import { useRouter } from 'expo-router';
import React from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AsyncBoundary, Button, Card, Chip, Text } from '@/components/ui';
import { CurriculumCard } from '@/components/coaching/CurriculumCard';
import { SkillSparkline } from '@/components/coaching/SkillSparkline';
import { useDashboard, useSkillTrend } from '@/hooks/useDashboard';
import { countUnread, useNotifications } from '@/hooks/useNotifications';
import { useDismissCurriculum } from '@/hooks/useProgress';
import { useTheme } from '@/theme/ThemeProvider';
import { suggestedScenario } from '@/utils/curriculum';
import { scenarioLabel } from '@/utils/labels';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Dashboard (architecture doc §7.3). */
export default function Home() {
  const theme = useTheme();
  const router = useRouter();
  const notifications = useNotifications();
  const unread = countUnread(notifications.data);
  const dashboard = useDashboard();
  const trend = useSkillTrend();
  const dismiss = useDismissCurriculum();

  const data = dashboard.data;
  const series = (trend.data ?? []).map((p) => p.composite_avg).reverse();
  const latest = series.length ? Math.round(series[series.length - 1]) : null;
  const isFirstRun = !!data && !data.last_session;
  const plan = data?.suggested_curriculum ?? null;

  const startPractice = () => router.push('/(app)/session/new');
  const startFromPlan = (scenario: string | null) =>
    router.push(scenario ? { pathname: '/(app)/session/new', params: { scenario } } : '/(app)/session/new');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={dashboard.isRefetching}
            onRefresh={() => {
              void dashboard.refetch();
              void trend.refetch();
            }}
          />
        }
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title">Home</Text>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <Button label={unread > 0 ? `Inbox (${unread > 9 ? '9+' : unread})` : 'Inbox'} variant="secondary" onPress={() => router.push('/(app)/notifications')} />
            <Button label="Buyers" variant="secondary" onPress={() => router.push('/(app)/persona')} />
            <Button label="Account" variant="secondary" onPress={() => router.push('/(app)/settings/account')} />
          </View>
        </View>

        <AsyncBoundary
          isLoading={dashboard.isPending}
          isError={dashboard.isError}
          error={dashboard.error}
          onRetry={() => void dashboard.refetch()}
          skeletonVariant="card"
          skeletonCount={3}
        >
          {isFirstRun ? (
            <Card style={{ gap: theme.spacing.md }}>
              <Text variant="heading">Run your first practice session</Text>
              <Text variant="body" color="secondary">
                Practice against a realistic buyer and get scored on six skills. Your progress will show up here.
              </Text>
              <Button label="Start your first practice session" variant="primary" fullWidth onPress={startPractice} />
            </Card>
          ) : data?.last_session ? (
            <Card style={{ gap: theme.spacing.sm }}>
              <Text variant="caption" color="secondary">
                Last session
              </Text>
              <Text variant="heading">{data.last_session.title ?? scenarioLabel(data.last_session.scenario_type)}</Text>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
                <Chip label={scenarioLabel(data.last_session.scenario_type)} />
                <Text variant="caption" color="tertiary">
                  {formatDate(data.last_session.completed_at)}
                </Text>
              </View>
              <Button
                label="View debrief"
                variant="secondary"
                onPress={() => router.push(`/(app)/session/${data.last_session!.id}/debrief`)}
              />
            </Card>
          ) : null}

          {series.length > 0 ? (
            <Card style={{ gap: theme.spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text variant="caption" color="secondary">
                  Skill trend
                </Text>
                {latest !== null ? <Text variant="heading">{latest}</Text> : null}
              </View>
              <SkillSparkline values={series} />
            </Card>
          ) : null}

          {plan && plan.sessions.length > 0 ? (
            <CurriculumCard plan={plan} dismissing={dismiss.isPending} onDismiss={() => dismiss.mutate(plan.id)} onStart={() => startFromPlan(suggestedScenario(plan))} />
          ) : null}

          {data?.team_progress ? (
            <Card style={{ gap: theme.spacing.xs }}>
              <Text variant="caption" color="secondary">
                Team progress
              </Text>
              <Text variant="heading">
                {data.team_progress.teamAverage === null ? '—' : Math.round(data.team_progress.teamAverage)} avg
              </Text>
              <Text variant="caption" color="tertiary">
                {data.team_progress.memberCount} member{data.team_progress.memberCount === 1 ? '' : 's'}
              </Text>
            </Card>
          ) : null}
        </AsyncBoundary>
      </ScrollView>
    </SafeAreaView>
  );
}
