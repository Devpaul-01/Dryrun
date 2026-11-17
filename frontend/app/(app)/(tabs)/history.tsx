import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Platform, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getSessionExportText } from '@/api/debrief';
import { AsyncBoundary, Badge, Button, Card, Chip, Text, TextField } from '@/components/ui';
import { useScenarioCatalog } from '@/hooks/usePersonas';
import { useArchiveSession, useDeleteSession, useRenameSession, useSessionHistory } from '@/hooks/useSessionHistory';
import { useTheme } from '@/theme/ThemeProvider';
import type { ScenarioType, SessionListItem } from '@/types/api';
import { scenarioLabel } from '@/utils/labels';
import { shareText } from '@/utils/shareText';
import { useDebouncedValue } from '@/utils/useDebouncedValue';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function confirmDelete(onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm('Delete this unfinished session?')) onConfirm();
    return;
  }
  Alert.alert('Delete this session?', 'This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

function SessionRow({ item, archivedView }: { item: SessionListItem; archivedView: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const rename = useRenameSession();
  const archive = useArchiveSession();
  const remove = useDeleteSession();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title ?? '');
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  const completed = item.status === 'completed';
  const label = item.title?.trim() || scenarioLabel(item.scenario_type);

  function openSession() {
    router.push(completed ? `/(app)/session/${item.id}/debrief` : `/(app)/session/${item.id}/live`);
  }

  async function exportIt() {
    setExporting(true);
    setExportFailed(false);
    try {
      await shareText(await getSessionExportText(item.id), `session-${item.id}.txt`);
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card style={{ gap: theme.spacing.sm }}>
      {editing ? (
        <View style={{ gap: theme.spacing.sm }}>
          <TextField label="Session name" value={title} onChangeText={setTitle} autoFocus counter={{ current: title.trim().length, max: 200 }} error={title.trim().length > 200 ? 'Name must be 200 characters or fewer' : undefined} />
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <Button
              label="Save"
              variant="primary"
              disabled={!title.trim() || title.trim().length > 200}
              loading={rename.isPending}
              onPress={() =>
                rename.mutate({ id: item.id, title: title.trim() }, { onSuccess: () => setEditing(false) })
              }
            />
            <Button label="Cancel" variant="ghost" onPress={() => { setEditing(false); setTitle(item.title ?? ''); }} />
          </View>
          {rename.isError ? (
            <Text variant="caption" color="negative">
              Could not rename. Try again.
            </Text>
          ) : null}
        </View>
      ) : (
        <>
          <Text variant="heading" accessibilityRole="button" onPress={openSession}>
            {label}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, alignItems: 'center' }}>
            <Badge label={scenarioLabel(item.scenario_type)} />
            <Badge label={completed ? 'Completed' : item.status === 'active' ? 'In progress' : 'Not started'} tone={completed ? 'positive' : 'neutral'} />
            <Text variant="caption" color="tertiary">
              {formatDate(item.completed_at ?? item.created_at)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            <Button label={open ? 'Less' : 'Actions'} variant="ghost" onPress={() => setOpen((o) => !o)} />
          </View>
          {open ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              <Button label="Rename" variant="secondary" onPress={() => setEditing(true)} />
              <Button
                label={archivedView ? 'Unarchive' : 'Archive'}
                variant="secondary"
                loading={archive.isPending}
                onPress={() => archive.mutate({ id: item.id, archive: !archivedView })}
              />
              {completed ? <Button label="Export" variant="secondary" loading={exporting} onPress={() => void exportIt()} /> : null}
              {/* Completed sessions can't be deleted (the backend returns 409 — they feed skill tracking), so the action is simply absent. */}
              {!completed ? <Button label="Delete" variant="destructive" loading={remove.isPending} onPress={() => confirmDelete(() => remove.mutate(item.id))} /> : null}
            </View>
          ) : null}
          {exportFailed || archive.isError || remove.isError ? (
            <Text variant="caption" color="negative">
              That didn&apos;t work. Please try again.
            </Text>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** History (architecture doc §7.11): searchable, filterable, with archive management. */
export default function History() {
  const theme = useTheme();
  const catalog = useScenarioCatalog();
  const [search, setSearch] = useState('');
  const [scenario, setScenario] = useState<ScenarioType | null>(null);
  const [archived, setArchived] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  const filters = useMemo(
    () => ({ archived, scenario_type: scenario ?? undefined, search: debouncedSearch.trim() || undefined }),
    [archived, scenario, debouncedSearch],
  );
  const history = useSessionHistory(filters);
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  const filtering = !!(filters.scenario_type || filters.search || archived);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }} edges={['top']}>
      <View style={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.md }}>
        <Text variant="title">History</Text>
        <TextField label="Search" value={search} onChangeText={setSearch} placeholder="Search your sessions" autoCapitalize="none" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          <Chip label="All scenarios" selectable selected={scenario === null} onPress={() => setScenario(null)} />
          {(catalog.data?.scenario_types ?? []).map((s) => (
            <Chip key={s.type} label={s.label} selectable selected={scenario === s.type} onPress={() => setScenario(scenario === s.type ? null : s.type)} />
          ))}
          <Chip label="Archived" selectable selected={archived} onPress={() => setArchived((a) => !a)} />
        </View>
      </View>

      <View style={{ flex: 1 }}>
        <AsyncBoundary
          isLoading={history.isPending}
          isError={history.isError}
          error={history.error}
          onRetry={() => void history.refetch()}
          isEmpty={items.length === 0}
          emptyTitle={filtering ? 'No sessions match' : 'No sessions yet'}
          emptyDescription={filtering ? 'Try a different search or clear the filters.' : 'Your practice sessions will appear here.'}
          skeletonVariant="row"
          skeletonCount={5}
        >
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, paddingTop: 0, gap: theme.spacing.md }}
            renderItem={({ item }) => <SessionRow item={item} archivedView={archived} />}
            onEndReached={() => {
              if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
            }}
            onEndReachedThreshold={0.4}
            refreshing={history.isRefetching && !history.isFetchingNextPage}
            onRefresh={() => void history.refetch()}
            ListFooterComponent={history.isFetchingNextPage ? <Text variant="caption" color="secondary" style={{ textAlign: 'center' }}>Loading more…</Text> : undefined}
          />
        </AsyncBoundary>
      </View>
    </SafeAreaView>
  );
}
