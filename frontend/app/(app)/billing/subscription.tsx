import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AsyncBoundary, Badge, Button, Card, Text } from '@/components/ui';
import { useActiveRole, useCancelSubscription, useReactivateSubscription, useSubscription, useUsage } from '@/hooks/useBilling';
import { useTheme } from '@/theme/ThemeProvider';
import { billingState, type BillingState } from '@/utils/billingState';
import { formatMoney } from '@/utils/money';

const STATE_LABEL: Record<BillingState, { label: string; tone: 'neutral' | 'accent' | 'warning' | 'negative' }> = {
  free: { label: 'Free', tone: 'neutral' },
  pending_payment: { label: 'Payment pending', tone: 'warning' },
  active: { label: 'Active', tone: 'accent' },
  cancelling: { label: 'Cancels at period end', tone: 'warning' },
  past_due: { label: 'Past due', tone: 'negative' },
  canceled: { label: 'Canceled', tone: 'neutral' },
};

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : null);

function confirmAsync(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Keep plan', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Cancel plan', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const theme = useTheme();
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="body">{label}</Text>
        <Text variant="body" color="secondary">
          {limit ? `${used} / ${limit}` : `${used} · unlimited`}
        </Text>
      </View>
      {limit ? (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.bg.elevated, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: pct >= 100 ? theme.colors.signal.negative : theme.colors.accent.primary }} />
        </View>
      ) : null}
    </View>
  );
}

/** Subscription & usage (architecture doc §7.16). Cancel is owner-only; plan changes live on Plans. */
export default function Subscription() {
  const theme = useTheme();
  const router = useRouter();
  const role = useActiveRole();
  const canManage = role === 'owner' || role === 'admin';
  const sub = useSubscription(canManage);
  const usage = useUsage();
  const cancel = useCancelSubscription();
  const reactivate = useReactivateSubscription();
  const state = billingState(sub.data);
  const plan = sub.data?.plans ?? usage.data?.plan ?? null;
  const limit = plan?.session_limit_per_month ?? null;
  const playbookLimit = (plan?.features as { playbook_limit?: number | null } | undefined)?.playbook_limit ?? null;
  const loading = usage.isPending || (canManage && sub.isPending);
  const mutationError = cancel.isError || reactivate.isError;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title">Subscription</Text>
          <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/settings/account'))} />
        </View>

        <AsyncBoundary
          isLoading={loading}
          isError={usage.isError || (canManage && sub.isError)}
          error={usage.error ?? sub.error}
          onRetry={() => {
            void usage.refetch();
            if (canManage) void sub.refetch();
          }}
          skeletonVariant="card"
        >
          <Card style={{ gap: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="heading">{plan?.name ?? 'Free'}</Text>
              <Badge label={STATE_LABEL[state].label} tone={STATE_LABEL[state].tone} />
            </View>
            {plan && Number(plan.price_amount) > 0 ? (
              <Text variant="body" color="secondary">
                {formatMoney(plan.price_amount, plan.currency)} / {plan.billing_interval === 'yearly' ? 'year' : 'month'}
              </Text>
            ) : null}
            {state === 'cancelling' ? (
              <Text variant="body" color="warning">
                Your plan stays active until {fmtDate(sub.data?.current_period_end) ?? 'the end of this period'}, then moves to Free.
              </Text>
            ) : state === 'active' && sub.data?.current_period_end ? (
              <Text variant="body" color="secondary">
                Renews on {fmtDate(sub.data.current_period_end)}
              </Text>
            ) : null}
            {state === 'past_due' ? (
              <Text variant="body" color="negative">
                Your last renewal payment failed. Update your payment to keep your plan.
              </Text>
            ) : null}
          </Card>

          {usage.data ? (
            <Card style={{ gap: theme.spacing.md }}>
              <Text variant="heading">This period</Text>
              <UsageRow label="Practice sessions" used={usage.data.sessions_this_period} limit={limit} />
              <UsageRow label="Playbooks" used={usage.data.playbooks_total} limit={playbookLimit} />
              <UsageRow label="Buyers from documents" used={usage.data.personas_from_document_this_period} limit={null} />
            </Card>
          ) : null}

          {mutationError ? (
            <Text variant="caption" color="negative">
              Couldn&apos;t update your subscription. Please try again.
            </Text>
          ) : null}

          <View style={{ gap: theme.spacing.sm }}>
            {canManage ? <Button label="View plans" variant="primary" fullWidth onPress={() => router.push('/(app)/billing/plans')} /> : null}
            {canManage ? <Button label="Invoices" variant="secondary" fullWidth onPress={() => router.push('/(app)/billing/invoices')} /> : null}
            {state === 'cancelling' && canManage ? (
              <Button label="Keep my plan" variant="secondary" fullWidth loading={reactivate.isPending} onPress={() => reactivate.mutate()} />
            ) : null}
            {state === 'active' && role === 'owner' ? (
              <Button
                label="Cancel subscription"
                variant="destructive"
                fullWidth
                loading={cancel.isPending}
                onPress={async () => {
                  const ok = await confirmAsync('Cancel your subscription?', `You keep your plan until ${fmtDate(sub.data?.current_period_end) ?? 'the end of this period'}.`);
                  if (ok) cancel.mutate();
                }}
              />
            ) : null}
            {!canManage ? (
              <Text variant="caption" color="tertiary">
                Billing is managed by workspace owners and admins.
              </Text>
            ) : null}
          </View>
        </AsyncBoundary>
      </ScrollView>
    </SafeAreaView>
  );
}
