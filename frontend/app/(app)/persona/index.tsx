import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PersonaCard } from '@/components/persona/PersonaCard';
import { AsyncBoundary, Button, Text, TextField } from '@/components/ui';
import { usePersonas } from '@/hooks/usePersonas';
import { useTheme } from '@/theme/ThemeProvider';

/** Persona library (architecture doc §7.6). */
export default function PersonaLibrary() {
  const theme = useTheme();
  const router = useRouter();
  const personas = usePersonas();
  const [query, setQuery] = useState('');

  const all = useMemo(() => personas.data?.pages.flatMap((p) => p.items) ?? [], [personas.data]);
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? all.filter((p) => `${p.name} ${p.role}`.toLowerCase().includes(needle))
    : all;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <View style={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title">Buyers</Text>
          <Button label="New" variant="primary" onPress={() => router.push('/(app)/persona/new')} />
        </View>
        {all.length > 0 ? (
          <TextField label="Search" value={query} onChangeText={setQuery} placeholder="Name or role" autoCapitalize="none" />
        ) : null}
      </View>

      <View style={{ flex: 1 }}>
        <AsyncBoundary
          isLoading={personas.isPending}
          isError={personas.isError}
          error={personas.error}
          onRetry={() => void personas.refetch()}
          isEmpty={all.length === 0}
          emptyTitle="No buyers yet"
          emptyDescription="Create a buyer persona to practice against — describe one, paste text, or build one from a website or document."
          emptyActionLabel="Create a buyer"
          onEmptyAction={() => router.push('/(app)/persona/new')}
          skeletonVariant="card"
        >
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{
              padding: theme.layout.screenPaddingPhone,
              paddingTop: 0,
              gap: theme.spacing.md,
            }}
            renderItem={({ item }) => (
              <PersonaCard persona={item} onPress={() => router.push(`/(app)/persona/${item.id}`)} />
            )}
            ListEmptyComponent={
              <Text variant="body" color="secondary" style={{ textAlign: 'center', marginTop: theme.spacing.xl }}>
                No buyers match “{query.trim()}”.
              </Text>
            }
            onEndReached={() => {
              if (personas.hasNextPage && !personas.isFetchingNextPage) void personas.fetchNextPage();
            }}
            onEndReachedThreshold={0.4}
            refreshing={personas.isRefetching && !personas.isFetchingNextPage}
            onRefresh={() => void personas.refetch()}
          />
        </AsyncBoundary>
      </View>
    </SafeAreaView>
  );
}
