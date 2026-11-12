import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { useMe } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';

/**
 * Auth gate (architecture doc §6): decides between (public), a
 * check-your-email step, and (app) on every cold start / token change.
 * (onboarding)'s GET /onboarding/status gating is M2 — until then, a
 * verified user with tokens lands straight in (app).
 *
 * Flow: hydrate stores -> no tokens? -> (public). Tokens present ->
 * GET /auth/me -> seed workspaceStore from current_workspace_id -> not
 * verified? -> check-your-email. Verified -> (app).
 */
export default function AuthGateLayout() {
  const tokens = useAuthStore((state) => state.tokens);
  const authHydrating = useAuthStore((state) => state.isHydrating);
  const workspaceHydrating = useWorkspaceStore((state) => state.isHydrating);
  const setActiveWorkspaceId = useWorkspaceStore((state) => state.setActiveWorkspaceId);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);

  const meQuery = useMe({ enabled: !!tokens });

  const storesHydrating = authHydrating || workspaceHydrating;
  const resolvingMe = !!tokens && meQuery.isPending;

  if (storesHydrating || resolvingMe) {
    return <LoadingScreen />;
  }

  if (!tokens) {
    return <Redirect href="/(public)/welcome" />;
  }

  if (meQuery.isError) {
    // A 401 here means refresh-and-replay already failed once inside
    // httpClient (which already cleared tokens) — this render will
    // naturally fall through to the !tokens branch above on the next
    // pass. Any other failure (network, 5xx) surfaces as a dead end
    // rather than silently sending a real user back to the welcome
    // screen while their tokens are still valid.
    if (isApiException(meQuery.error) && meQuery.error.status === 401) {
      return <LoadingScreen />;
    }
    return <AuthGateError onRetry={() => meQuery.refetch()} />;
  }

  const user = meQuery.data;
  if (!user) {
    return <LoadingScreen />;
  }

  if (user.current_workspace_id && user.current_workspace_id !== activeWorkspaceId) {
    void setActiveWorkspaceId(user.current_workspace_id);
  }

  if (!user.email_verified_at) {
    return <Redirect href="/(public)/check-email" />;
  }

  return <Redirect href="/(app)/(tabs)/home" />;
}

function LoadingScreen() {
  const theme = useTheme();
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

function AuthGateError({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.bg.canvas,
        padding: theme.spacing.xl,
        gap: theme.spacing.md,
      }}
    >
      <Text variant="heading" style={{ textAlign: 'center' }}>
        Couldn&apos;t reach DryRun
      </Text>
      <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>
        Check your connection and try again.
      </Text>
      <Button label="Retry" variant="secondary" onPress={onRetry} />
    </View>
  );
}
