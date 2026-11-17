import React from 'react';
import { View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import type { CurriculumPlan } from '@/types/api';
import { stepLabel } from '@/utils/curriculum';
import { axisLabel } from '@/utils/labels';

export interface CurriculumCardProps {
  plan: CurriculumPlan;
  onStart: () => void;
  onDismiss: () => void;
  dismissing?: boolean;
}

/** Recommended next sessions. Shared by Home and Progress so both show the same dismissible plan. */
export function CurriculumCard({ plan, onStart, onDismiss, dismissing }: CurriculumCardProps) {
  const theme = useTheme();
  if (plan.sessions.length === 0) return null;
  return (
    <Card style={{ gap: theme.spacing.sm }}>
      <Text variant="caption" color="secondary">
        Suggested next
      </Text>
      {plan.weakness_identified ? (
        <Text variant="body" color="secondary">
          Focus area: {axisLabel(plan.weakness_identified)}
        </Text>
      ) : null}
      {plan.sessions.map((step) => (
        <Text key={step.session_number} variant="body">
          {step.session_number}. {stepLabel(step)}
        </Text>
      ))}
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <Button label="Start practicing" variant="primary" onPress={onStart} />
        <Button label="Dismiss" variant="ghost" loading={dismissing} onPress={onDismiss} />
      </View>
    </Card>
  );
}
