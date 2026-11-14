import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { Button, Card, Text } from '@/components/ui';
import { useLogout, useMe } from '@/hooks/useAuth';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Account screen. M1 scope: who you're signed in as, the workspace
 * switcher, and log out. Delete/export account and profile editing are
 * M7 and extend this screen rather than replace it.
 */
export default function Account() {
  const theme = useTheme();
  const router = useRouter();
  const me = useMe();
  const logout = useLogout();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView
        contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.xl }}
      >
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title">Account</Text>
          <Text variant="body" color="secondary">
            {me.data?.display_name ? `${me.data.display_name} · ` : ''}
            {me.data?.email ?? ''}
          </Text>
        </View>

        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">Workspace</Text>
          <WorkspaceSwitcher />
        </View>

        <Card>
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="heading">Session</Text>
            <Button
              label="Log out"
              variant="destructive"
              fullWidth
              loading={logout.isPending}
              onPress={() => logout.mutate(undefined)}
            />
          </View>
        </Card>

        <Button label="Back" variant="ghost" fullWidth onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
