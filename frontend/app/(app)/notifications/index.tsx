import { useRouter } from 'expo-router';
import React from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AsyncBoundary, Button, Card, Text } from '@/components/ui';
import { countUnread, useMarkAllRead, useMarkRead, useNotifications } from '@/hooks/useNotifications';
import { useTheme } from '@/theme/ThemeProvider';
import { notificationRoute, notificationText } from '@/utils/notificationRoute';

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** In-app inbox (GET /notifications). Tapping a row marks it read and opens its target screen. */
export default function Notifications() {
  const theme = useTheme();
  const router = useRouter();
  const list = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = countUnread(list.data);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <View style={{ padding: theme.layout.screenPaddingPhone, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="title">Notifications</Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
          {unread > 0 ? <Button label="Mark all read" variant="ghost" loading={markAll.isPending} onPress={() => markAll.mutate()} /> : null}
          <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)/home'))} />
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <AsyncBoundary
          isLoading={list.isPending}
          isError={list.isError}
          error={list.error}
          onRetry={() => void list.refetch()}
          isEmpty={items.length === 0}
          emptyTitle="You're all caught up"
          emptyDescription="Debrief and account updates will show up here."
          skeletonVariant="card"
        >
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, paddingTop: 0, gap: theme.spacing.md }}
            renderItem={({ item }) => {
              const { title, body } = notificationText(item.payload);
              const target = notificationRoute(item.type, item.payload);
              const isUnread = !item.read_at;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${isUnread ? 'Unread. ' : ''}${title}`}
                  onPress={() => {
                    if (isUnread) markRead.mutate(item.id);
                    if (target) router.push(target);
                  }}
                >
                  <Card style={{ gap: 4, borderColor: isUnread ? theme.colors.accent.primary : undefined }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm }}>
                      <Text variant="heading" style={{ flex: 1 }}>
                        {isUnread ? '● ' : ''}
                        {title}
                      </Text>
                      <Text variant="caption" color="tertiary">
                        {when(item.created_at)}
                      </Text>
                    </View>
                    {body ? (
                      <Text variant="body" color="secondary" numberOfLines={3}>
                        {body}
                      </Text>
                    ) : null}
                  </Card>
                </Pressable>
              );
            }}
            onEndReached={() => {
              if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
            }}
            onEndReachedThreshold={0.4}
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => void list.refetch()}
          />
        </AsyncBoundary>
      </View>
    </SafeAreaView>
  );
}
