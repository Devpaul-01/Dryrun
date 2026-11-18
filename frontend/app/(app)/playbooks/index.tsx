import { useRouter } from 'expo-router';
import React from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AsyncBoundary, Badge, Button, Card, Text } from '@/components/ui';
import { usePlaybooks } from '@/hooks/usePlaybooks';
import { useTheme } from '@/theme/ThemeProvider';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Playbook library (architecture doc §7.13). Playbooks are created from a debrief, so the empty state points there. */
export default function PlaybookLibrary() {
  const theme = useTheme();
  const router = useRouter();
  const playbooks = usePlaybooks();
  const items = playbooks.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <View style={{ padding: theme.layout.screenPaddingPhone, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="title">Playbooks</Text>
        <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)/home'))} />
      </View>
      <View style={{ flex: 1 }}>
        <AsyncBoundary
          isLoading={playbooks.isPending}
          isError={playbooks.isError}
          error={playbooks.error}
          onRetry={() => void playbooks.refetch()}
          isEmpty={items.length === 0}
          emptyTitle="No playbooks yet"
          emptyDescription="After a session that goes well, turn it into a reusable playbook from the debrief."
          emptyActionLabel="Start a session"
          onEmptyAction={() => router.push('/(app)/session/new')}
          skeletonVariant="card"
        >
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, paddingTop: 0, gap: theme.spacing.md }}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" onPress={() => router.push(`/(app)/playbooks/${item.id}`)}>
                <Card style={{ gap: theme.spacing.xs }}>
                  <Text variant="heading">{item.title}</Text>
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
                    <Text variant="caption" color="tertiary">
                      {formatDate(item.created_at)}
                    </Text>
                    {item.share_token ? <Badge label="Shared" tone="accent" /> : null}
                  </View>
                </Card>
              </Pressable>
            )}
            onEndReached={() => {
              if (playbooks.hasNextPage && !playbooks.isFetchingNextPage) void playbooks.fetchNextPage();
            }}
            onEndReachedThreshold={0.4}
            refreshing={playbooks.isRefetching && !playbooks.isFetchingNextPage}
            onRefresh={() => void playbooks.refetch()}
          />
        </AsyncBoundary>
      </View>
    </SafeAreaView>
  );
}
