import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { useLogout } from '@/hooks/useAuth';
import { useTheme } from '@/theme/ThemeProvider';

function Centered({ children }: { children: React.ReactNode }) {
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
      {children}
    </View>
  );
}

export function GateLoading() {
  const theme = useTheme();
  return (
    <Centered>
      <ActivityIndicator color={theme.colors.accent.primary} />
    </Centered>
  );
}

export function GateError({ onRetry }: { onRetry: () => void }) {
  return (
    <Centered>
      <Text variant="heading" style={{ textAlign: 'center' }}>
        Couldn&apos;t reach DryRun
      </Text>
      <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>
        Check your connection and try again.
      </Text>
      <Button label="Retry" variant="secondary" onPress={onRetry} />
    </Centered>
  );
}

/**
 * Fallback for an account with no workspace. Signup normally provisions
 * one, and the API has no endpoint to create one, so the only honest
 * options are retrying or signing out.
 */
export function GateNoWorkspace({ onRetry }: { onRetry: () => void }) {
  const logout = useLogout();
  return (
    <Centered>
      <Text variant="heading" style={{ textAlign: 'center' }}>
        No workspace found
      </Text>
      <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>
        Your account isn&apos;t part of a workspace yet. If you were invited to one, accept the
        invite first, then try again.
      </Text>
      <Button label="Try again" variant="secondary" onPress={onRetry} />
      <Button
        label="Log out"
        variant="ghost"
        loading={logout.isPending}
        onPress={() => logout.mutate(undefined)}
      />
    </Centered>
  );
}
