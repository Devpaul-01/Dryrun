import { Redirect } from 'expo-router';
import React from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { GateError, GateLoading, GateNoWorkspace } from '@/components/GateScreens';
import { ME_QUERY_KEY } from '@/hooks/useAuth';
import { useGateState } from '@/hooks/useGateState';

/**
 * App entry point and the landing spot for any moment the gate state
 * leaves the user's current route group (the root layout's route guards
 * bounce them here). Renders a holding screen for states that have no
 * route of their own, otherwise redirects to where the state belongs.
 */
export default function Index() {
  const gate = useGateState();
  const queryClient = useQueryClient();

  switch (gate.kind) {
    case 'loading':
      return <GateLoading />;
    case 'error':
      return <GateError onRetry={gate.retry} />;
    case 'no-workspace':
      return (
        <GateNoWorkspace
          onRetry={() => void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })}
        />
      );
    case 'public':
      return <Redirect href="/(public)/welcome" />;
    case 'unverified':
      return <Redirect href="/(public)/check-email" />;
    case 'app':
      return <Redirect href="/(app)/(tabs)/home" />;
  }
}
