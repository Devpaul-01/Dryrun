import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { AsyncBoundary, Button, Card, Text, TextField } from '@/components/ui';
import { useActiveRole } from '@/hooks/useBilling';
import { useLeaveWorkspace, useRenameWorkspace, useWorkspaces } from '@/hooks/useWorkspaces';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';
import { confirmAsync } from '@/utils/confirm';

/** Workspace settings: rename (owner/admin), switch, leave (anyone but the owner). */
export default function WorkspaceSettings() {
  const theme = useTheme();
  const router = useRouter();
  const role = useActiveRole();
  const activeId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaces();
  const current = workspaces.data?.find((w) => w.id === activeId);
  const rename = useRenameWorkspace();
  const leave = useLeaveWorkspace();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (current) setName(current.name); }, [current?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimmed = name.trim();
  const nameError = trimmed.length === 0 ? 'Name is required.' : trimmed.length > 200 ? 'Keep it under 200 characters.' : undefined;
  const canRename = role === 'owner' || role === 'admin';
  const dirty = !!current && trimmed !== current.name;
  const leaveError = leave.isError ? (isApiException(leave.error) ? (leave.error.body?.message ?? 'Could not leave.') : 'Could not leave. Please try again.') : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="title">Workspace</Text>
          <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/settings/account'))} />
        </View>

        <AsyncBoundary isLoading={workspaces.isPending} isError={workspaces.isError} error={workspaces.error} onRetry={() => void workspaces.refetch()} skeletonVariant="card">
          <Card style={{ gap: theme.spacing.sm }}>
            <TextField label="Workspace name" value={name} onChangeText={(t) => { setName(t); setSaved(false); }} editable={canRename} error={nameError} />
            {canRename ? (
              <>
                {rename.isError ? (
                  <Text variant="caption" color="negative">
                    Couldn&apos;t rename the workspace. Please try again.
                  </Text>
                ) : null}
                {saved ? (
                  <Text variant="caption" color="positive">
                    Saved.
                  </Text>
                ) : null}
                <Button label="Save name" variant="primary" disabled={!dirty || !!nameError} loading={rename.isPending} onPress={() => rename.mutate(trimmed, { onSuccess: () => setSaved(true) })} />
              </>
            ) : (
              <Text variant="caption" color="tertiary">
                Only owners and admins can rename the workspace.
              </Text>
            )}
          </Card>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">Your workspaces</Text>
            <WorkspaceSwitcher />
          </View>

          <Button label="Team members" variant="secondary" fullWidth onPress={() => router.push('/(app)/workspace')} />

          {role && role !== 'owner' ? (
            <Card style={{ gap: theme.spacing.sm }}>
              <Text variant="heading">Leave workspace</Text>
              <Text variant="body" color="secondary">
                You&apos;ll lose access to this workspace&apos;s sessions, personas and playbooks.
              </Text>
              {leaveError ? (
                <Text variant="caption" color="negative">
                  {leaveError}
                </Text>
              ) : null}
              <Button
                label="Leave workspace"
                variant="destructive"
                loading={leave.isPending}
                onPress={async () => {
                  if (await confirmAsync(`Leave ${current?.name ?? 'this workspace'}?`, 'You can rejoin only if someone invites you again.', 'Leave', true)) {
                    leave.mutate(undefined, { onSuccess: () => router.replace('/(app)/(tabs)/home') });
                  }
                }}
              />
            </Card>
          ) : role === 'owner' ? (
            <Text variant="caption" color="tertiary">
              Owners can&apos;t leave. Transfer ownership to another member first.
            </Text>
          ) : null}
        </AsyncBoundary>
      </ScrollView>
    </SafeAreaView>
  );
}
