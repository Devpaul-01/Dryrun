import React from 'react';
import { Pressable, View } from 'react-native';

import { Badge, Card, Skeleton, Text } from '@/components/ui';
import { useWorkspaces, useSwitchWorkspace } from '@/hooks/useWorkspaces';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useTheme } from '@/theme/ThemeProvider';

/** Lists the user's workspaces; tapping one makes it the active/default workspace. */
export function WorkspaceSwitcher() {
  const theme = useTheme();
  const workspaces = useWorkspaces();
  const switchWorkspace = useSwitchWorkspace();
  const activeId = useWorkspaceStore((state) => state.activeWorkspaceId);

  if (workspaces.isPending) {
    return <Skeleton variant="card" />;
  }

  if (workspaces.isError) {
    return (
      <Card>
        <Text variant="caption" color="negative">
          Couldn&apos;t load your workspaces.
        </Text>
        <Pressable onPress={() => workspaces.refetch()} accessibilityRole="button">
          <Text variant="caption" color="accent">
            Try again
          </Text>
        </Pressable>
      </Card>
    );
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {workspaces.data.map((workspace) => {
        const isActive = workspace.id === activeId;
        return (
          <Pressable
            key={workspace.id}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive, busy: switchWorkspace.isPending }}
            disabled={isActive || switchWorkspace.isPending}
            onPress={() => switchWorkspace.mutate(workspace.id)}
          >
            <Card
              nested
              style={isActive ? { borderColor: theme.colors.accent.primary } : undefined}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="body">{workspace.name}</Text>
                <Badge label={isActive ? 'Active' : workspace.role} tone={isActive ? 'accent' : 'neutral'} />
              </View>
            </Card>
          </Pressable>
        );
      })}
      {switchWorkspace.isError ? (
        <Text variant="caption" color="negative">
          Couldn&apos;t switch workspace. Please try again.
        </Text>
      ) : null}
    </View>
  );
}
