import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuthStore } from '@/stores/authStore';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Auth gate (architecture doc §6): decides between (public), a workspace
 * fallback step, (onboarding), and (app) on every cold start / token
 * change. Full GET /auth/me + onboarding-status resolution lands in M1 —
 * for now this only gates on local token presence so the three downstream
 * route groups are reachable and testable independently.
 */
export default function AuthGateLayout() {
  const theme = useTheme();
  const tokens = useAuthStore((state) => state.tokens);
  const isHydrating = useAuthStore((state) => state.isHydrating);

  if (isHydrating) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.bg.canvas,
        }}
      >
        <ActivityIndicator color={theme.colors.accent.primary} />
      </View>
    );
  }

  if (!tokens) {
    return <Redirect href="/(public)/welcome" />;
  }

  // TODO (M1): GET /auth/me, workspace resolution, and onboarding_completed
  // gating. Until then, a present token routes straight into (app).
  return <Redirect href="/(app)/(tabs)/home" />;
}
