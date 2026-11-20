import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AsyncBoundary, Button, Card, Text } from '@/components/ui';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/hooks/useAccount';
import { useTheme } from '@/theme/ThemeProvider';
import { registerForPush } from '@/utils/push';

function Row({ title, description, value, onChange }: { title: string; description: string; value: boolean; onChange: (v: boolean) => void }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading">{title}</Text>
        <Text variant="caption" color="secondary">
          {description}
        </Text>
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={title} />
    </View>
  );
}

/** Notification preferences (GET/PATCH /user/notification-preferences). */
export default function NotificationSettings() {
  const theme = useTheme();
  const router = useRouter();
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const [pushNote, setPushNote] = useState<string | null>(null);

  // Turning push on needs OS permission and a device token first; only then do we persist the preference.
  const togglePush = async (on: boolean) => {
    setPushNote(null);
    if (on) {
      const r = await registerForPush();
      if (r.status === 'denied') return setPushNote('Notifications are turned off for DryRun in your device settings.');
      if (r.status === 'unsupported') return setPushNote('Push notifications are available in the mobile app.');
      if (r.status === 'error') return setPushNote('Could not set up push notifications. Please try again.');
    }
    update.mutate({ async_ready_push_enabled: on });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title">Notifications</Text>
          <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/settings/account'))} />
        </View>
        <AsyncBoundary isLoading={prefs.isPending} isError={prefs.isError} error={prefs.error} onRetry={() => void prefs.refetch()} skeletonVariant="card">
          {prefs.data ? (
            <Card style={{ gap: theme.spacing.lg }}>
              <Row
                title="Weekly summary"
                description="An email each week with your progress and what to practice next."
                value={prefs.data.weekly_summary_enabled}
                onChange={(v) => update.mutate({ weekly_summary_enabled: v })}
              />
              <Row
                title="Push when results are ready"
                description="Get notified when a debrief or replay finishes in the background."
                value={prefs.data.async_ready_push_enabled}
                onChange={(v) => void togglePush(v)}
              />
            </Card>
          ) : null}
          {pushNote ? (
            <Text variant="caption" color="warning">
              {pushNote}
            </Text>
          ) : null}
          {update.isError ? (
            <Text variant="caption" color="negative">
              Couldn&apos;t save that change. It&apos;s been reverted.
            </Text>
          ) : null}
        </AsyncBoundary>
      </ScrollView>
    </SafeAreaView>
  );
}
