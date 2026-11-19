import { useRouter, type Href } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Button, Card, Text } from '@/components/ui';
import { useDeleteAccount, useRequestDataExport } from '@/hooks/useAccount';
import { useLogout, useMe } from '@/hooks/useAuth';
import { useActiveRole } from '@/hooks/useBilling';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';
import { confirmAsync } from '@/utils/confirm';

function LinkRow({ label, hint, href }: { label: string; hint?: string; href: Href }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={{ paddingVertical: theme.spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="caption" color="tertiary">
            {hint}
          </Text>
        ) : null}
      </View>
      <Text variant="body" color="tertiary">
        ›
      </Text>
    </Pressable>
  );
}

/** Settings hub: profile, workspace, billing, preferences, data export, sign out, delete (architecture doc §7.18). */
export default function Account() {
  const theme = useTheme();
  const router = useRouter();
  const me = useMe();
  const role = useActiveRole();
  const logout = useLogout();
  const exportData = useRequestDataExport();
  const del = useDeleteAccount();
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const exportError = exportData.isError
    ? isApiException(exportData.error) && exportData.error.status === 429
      ? 'You requested an export recently. Please try again later.'
      : 'Could not start the export. Please try again.'
    : null;
  const deleteError = del.isError
    ? isApiException(del.error)
      ? (del.error.body?.message ?? 'Could not delete your account.')
      : 'Could not delete your account. Please try again.'
    : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Avatar name={me.data?.display_name || me.data?.email || '?'} size={56} />
          <View style={{ flex: 1 }}>
            <Text variant="title" numberOfLines={1}>
              {me.data?.display_name || 'Account'}
            </Text>
            <Text variant="caption" color="secondary" numberOfLines={1}>
              {me.data?.email ?? ''}
            </Text>
          </View>
        </View>

        <Card>
          <LinkRow label="Profile" hint="Your name" href="/(app)/settings/profile" />
          <LinkRow label="Notifications" hint="Weekly summary and push" href="/(app)/settings/notifications" />
        </Card>

        <Card>
          <LinkRow label="Workspace" hint="Name, switch, leave" href="/(app)/workspace/settings" />
          <LinkRow label="Team" hint={role === 'member' ? 'Members' : 'Members and invites'} href="/(app)/workspace" />
          <LinkRow label="Subscription" hint="Plan and usage" href="/(app)/billing/subscription" />
          <LinkRow label="Playbooks" href="/(app)/playbooks" />
        </Card>

        <Card style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Your data</Text>
          <Text variant="body" color="secondary">
            Request a copy of your data. We&apos;ll notify you when it&apos;s ready.
          </Text>
          {exportMsg ? (
            <Text variant="caption" color="positive">
              {exportMsg}
            </Text>
          ) : null}
          {exportError ? (
            <Text variant="caption" color="negative">
              {exportError}
            </Text>
          ) : null}
          <Button label="Export my data" variant="secondary" loading={exportData.isPending} onPress={() => exportData.mutate(undefined, { onSuccess: (r) => setExportMsg(r.message) })} />
        </Card>

        <Button label="Log out" variant="secondary" fullWidth loading={logout.isPending} onPress={() => logout.mutate(undefined)} />

        <Card style={{ gap: theme.spacing.sm, borderColor: theme.colors.signal.negative }}>
          <Text variant="heading" color="negative">
            Delete account
          </Text>
          <Text variant="body" color="secondary">
            Your account is scheduled for deletion and permanently removed after 14 days. Log in again within that window to restore it. If you own a workspace with other members, transfer ownership first.
          </Text>
          {deleteError ? (
            <Text variant="caption" color="negative">
              {deleteError}
            </Text>
          ) : null}
          <Button
            label="Delete my account"
            variant="destructive"
            loading={del.isPending}
            onPress={async () => {
              if (await confirmAsync('Delete your account?', 'You will be signed out and your account scheduled for deletion in 14 days.', 'Delete', true)) del.mutate();
            }}
          />
        </Card>

        <Button label="Back" variant="ghost" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)/home'))} />
      </ScrollView>
    </SafeAreaView>
  );
}
