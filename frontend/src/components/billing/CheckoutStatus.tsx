import React from 'react';

import { Button, Card, Text } from '@/components/ui';
import type { CheckoutPhase } from '@/hooks/useCheckoutFlow';
import { useTheme } from '@/theme/ThemeProvider';

/** Inline status for the hosted-checkout flow: verifying, success, "not confirmed yet" (retry), or error. */
export function CheckoutStatus({ phase, onCheckAgain, onDismiss }: { phase: CheckoutPhase; onCheckAgain: () => void; onDismiss: () => void }) {
  const theme = useTheme();
  if (phase === 'idle' || phase === 'opening') return null;
  const copy = {
    verifying: { t: 'Confirming your payment…', b: 'This usually takes a few seconds.', c: 'secondary' as const },
    success: { t: "You're upgraded", b: 'Your new plan is active.', c: 'positive' as const },
    unverified: { t: "We couldn't confirm the payment yet", b: "If you completed it, it can take a minute to reach us. If you didn't, you can start again.", c: 'warning' as const },
    error: { t: 'Something went wrong', b: 'Your card was not charged by us. Please try again.', c: 'negative' as const },
  }[phase];
  return (
    <Card style={{ gap: theme.spacing.xs }}>
      <Text variant="heading" color={copy.c}>
        {copy.t}
      </Text>
      <Text variant="body" color="secondary">
        {copy.b}
      </Text>
      {phase === 'unverified' ? <Button label="Check again" variant="secondary" onPress={onCheckAgain} /> : null}
      {phase !== 'verifying' ? <Button label="Dismiss" variant="ghost" onPress={onDismiss} /> : null}
    </Card>
  );
}
