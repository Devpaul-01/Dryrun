import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CheckoutStatus } from '@/components/billing/CheckoutStatus';
import { AsyncBoundary, Badge, Button, Card, Text } from '@/components/ui';
import { useActiveRole, useChangePlan, usePlans, useSubscription } from '@/hooks/useBilling';
import { useCheckoutFlow } from '@/hooks/useCheckoutFlow';
import { useTheme } from '@/theme/ThemeProvider';
import type { Plan } from '@/types/api';
import { isApiException } from '@/types/errors';
import { billingState, planAction, planFeatures } from '@/utils/billingState';
import { confirmAsync } from '@/utils/confirm';
import { formatMoney } from '@/utils/money';

/** Plans & checkout (architecture doc §7.15). Buying is owner/admin; members see plans read-only. */
export default function Plans() {
  const theme = useTheme();
  const router = useRouter();
  const role = useActiveRole();
  const canManage = role === 'owner' || role === 'admin';
  const plans = usePlans();
  const subscription = useSubscription(canManage);
  const checkout = useCheckoutFlow();
  const changePlan = useChangePlan();
  const [changeError, setChangeError] = useState<string | null>(null);
  const sub = subscription.data;
  const state = billingState(sub);

  const onSelect = async (plan: Plan) => {
    setChangeError(null);
    const action = planAction(plan, sub);
    if (action === 'checkout') return void checkout.begin(plan.key);
    if (action === 'change') {
      const ok = await confirmAsync(`Switch to ${plan.name}?`, 'Your new plan takes effect immediately. The new price applies from your next renewal.', 'Switch');
      if (!ok) return;
      changePlan.mutate(plan.key, {
        onError: (e) => setChangeError(isApiException(e) ? (e.body?.message ?? 'Could not change plan.') : 'Could not change plan. Please try again.'),
      });
    }
  };

  const loading = plans.isPending || (canManage && subscription.isPending);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title">Plans</Text>
          <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/settings/account'))} />
        </View>

        {!canManage && role ? (
          <Card>
            <Text variant="body" color="secondary">
              Only workspace owners and admins can change the plan. Ask one of them to upgrade.
            </Text>
          </Card>
        ) : null}

        {state === 'pending_payment' && canManage ? (
          <Card style={{ gap: theme.spacing.xs }}>
            <Text variant="heading">Payment pending</Text>
            <Text variant="body" color="secondary">
              You started a checkout that hasn&apos;t been confirmed.
            </Text>
            {sub?.pending_tx_ref ? <Button label="Check payment status" variant="secondary" onPress={() => void checkout.verify(sub.pending_tx_ref as string)} /> : null}
          </Card>
        ) : null}

        <CheckoutStatus phase={checkout.phase} onCheckAgain={() => checkout.txRef && void checkout.verify(checkout.txRef)} onDismiss={checkout.reset} />

        <AsyncBoundary
          isLoading={loading}
          isError={plans.isError || (canManage && subscription.isError)}
          error={plans.error ?? subscription.error}
          onRetry={() => {
            void plans.refetch();
            if (canManage) void subscription.refetch();
          }}
          skeletonVariant="card"
        >
          <View style={{ gap: theme.spacing.md }}>
            {(plans.data ?? []).map((plan) => {
              const action = canManage ? planAction(plan, sub) : 'none';
              const isCurrent = canManage && action === 'current';
              return (
                <Card key={plan.id} style={{ gap: theme.spacing.sm, borderColor: isCurrent ? theme.colors.accent.primary : undefined }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text variant="heading">{plan.name}</Text>
                    {isCurrent ? <Badge label="Current plan" tone="accent" /> : null}
                  </View>
                  <Text variant="title">
                    {Number(plan.price_amount) === 0 ? 'Free' : formatMoney(plan.price_amount, plan.currency)}
                    {Number(plan.price_amount) > 0 ? (
                      <Text variant="caption" color="secondary">
                        {` / ${plan.seat_based ? 'seat / ' : ''}${plan.billing_interval === 'yearly' ? 'year' : 'month'}`}
                      </Text>
                    ) : null}
                  </Text>
                  <View style={{ gap: 2 }}>
                    {planFeatures(plan).map((f) => (
                      <Text key={f} variant="body" color="secondary">
                        • {f}
                      </Text>
                    ))}
                  </View>
                  {action === 'checkout' || action === 'change' ? (
                    <Button
                      label={action === 'checkout' ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
                      variant="primary"
                      fullWidth
                      loading={(action === 'checkout' && (checkout.starting || checkout.phase === 'opening')) || (action === 'change' && changePlan.isPending)}
                      onPress={() => void onSelect(plan)}
                    />
                  ) : null}
                </Card>
              );
            })}
            {changeError ? (
              <Text variant="caption" color="negative">
                {changeError}
              </Text>
            ) : null}
            {canManage && sub ? <Button label="Manage subscription" variant="secondary" fullWidth onPress={() => router.push('/(app)/billing/subscription')} /> : null}
          </View>
        </AsyncBoundary>
      </ScrollView>
    </SafeAreaView>
  );
}
