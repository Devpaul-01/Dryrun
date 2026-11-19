import { useRouter } from 'expo-router';
import React from 'react';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AsyncBoundary, Badge, Button, Card, Text } from '@/components/ui';
import { useActiveRole, useInvoices } from '@/hooks/useBilling';
import { useTheme } from '@/theme/ThemeProvider';
import { formatMoney } from '@/utils/money';

/** Payment history (owner/admin on the backend). */
export default function Invoices() {
  const theme = useTheme();
  const router = useRouter();
  const role = useActiveRole();
  const allowed = role === 'owner' || role === 'admin';
  const invoices = useInvoices(allowed);
  const items = invoices.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <View style={{ padding: theme.layout.screenPaddingPhone, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="title">Invoices</Text>
        <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/billing/subscription'))} />
      </View>
      <View style={{ flex: 1 }}>
        {role && !allowed ? (
          <View style={{ padding: theme.layout.screenPaddingPhone }}>
            <Text variant="body" color="secondary">
              Only workspace owners and admins can see invoices.
            </Text>
          </View>
        ) : (
          <AsyncBoundary
            isLoading={invoices.isPending}
            isError={invoices.isError}
            error={invoices.error}
            onRetry={() => void invoices.refetch()}
            isEmpty={items.length === 0}
            emptyTitle="No payments yet"
            emptyDescription="Your payments will appear here after you upgrade."
            skeletonVariant="card"
          >
            <FlatList
              data={items}
              keyExtractor={(i) => i.id}
              contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, paddingTop: 0, gap: theme.spacing.md }}
              renderItem={({ item }) => (
                <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text variant="heading">{item.amount == null || !item.currency ? '—' : formatMoney(item.amount, item.currency)}</Text>
                    <Text variant="caption" color="tertiary">
                      {new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                  </View>
                  <Badge label={item.status} tone={item.status === 'success' || item.status === 'successful' ? 'accent' : 'neutral'} />
                </Card>
              )}
              onEndReached={() => {
                if (invoices.hasNextPage && !invoices.isFetchingNextPage) void invoices.fetchNextPage();
              }}
              onEndReachedThreshold={0.4}
            />
          </AsyncBoundary>
        )}
      </View>
    </SafeAreaView>
  );
}
