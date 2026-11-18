import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlaybookView } from '@/components/coaching/PlaybookView';
import { AsyncBoundary, Button, Card, Text } from '@/components/ui';
import { usePublicPlaybook } from '@/hooks/usePlaybooks';
import { useTheme } from '@/theme/ThemeProvider';

function isNotFound(error: unknown): boolean {
  const status = (error as { status?: number; response?: { status?: number } } | null)?.status ??
    (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 404;
}

/** Public, unauthenticated shared playbook (deep link `/playbook/:token`). Lives outside every auth guard. */
export default function PublicPlaybookScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const query = usePublicPlaybook(token);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg }}>
        {query.isError && isNotFound(query.error) ? (
          <Card style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">This playbook isn&apos;t available</Text>
            <Text variant="body" color="secondary">
              The link may have been turned off by its owner, or it may be mistyped.
            </Text>
          </Card>
        ) : (
          <AsyncBoundary isLoading={query.isPending} isError={query.isError} error={query.error} onRetry={() => void query.refetch()} skeletonVariant="card">
            {query.data ? (
              <View style={{ gap: theme.spacing.lg }}>
                <Text variant="title">{query.data.title}</Text>
                <PlaybookView version={query.data.current_version} />
                {query.data.share_attribution_enabled ? (
                  <Text variant="caption" color="tertiary">
                    Created with DryRun
                  </Text>
                ) : null}
              </View>
            ) : null}
          </AsyncBoundary>
        )}
        <Button label="Open DryRun" variant="secondary" fullWidth onPress={() => router.replace('/')} />
      </ScrollView>
    </SafeAreaView>
  );
}
