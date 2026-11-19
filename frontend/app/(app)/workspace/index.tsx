import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AsyncBoundary, Avatar, Badge, Button, Card, Chip, Text, TextField } from '@/components/ui';
import { useMe } from '@/hooks/useAuth';
import { useActiveRole } from '@/hooks/useBilling';
import {
  useInviteMember,
  useRemoveMember,
  useSetMemberRole,
  useTeamProgress,
  useTransferOwnership,
  useWorkspaceMembers,
} from '@/hooks/useWorkspaces';
import { useTheme } from '@/theme/ThemeProvider';
import type { MemberListItem } from '@/types/api';
import { isApiException } from '@/types/errors';
import { confirmAsync } from '@/utils/confirm';
import { memberActions, type MemberAction } from '@/utils/memberActions';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const errMsg = (e: unknown, fallback: string) => (isApiException(e) ? (e.body?.message ?? fallback) : fallback);

function InviteForm() {
  const theme = useTheme();
  const invite = useInviteMember();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [touched, setTouched] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const emailError = touched && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : undefined;

  return (
    <Card style={{ gap: theme.spacing.sm }}>
      <Text variant="heading">Invite a teammate</Text>
      <TextField label="Email" value={email} onChangeText={(t) => { setEmail(t); setSentTo(null); }} autoCapitalize="none" keyboardType="email-address" error={emailError} />
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <Chip label="Member" selectable selected={role === 'member'} onPress={() => setRole('member')} />
        <Chip label="Admin" selectable selected={role === 'admin'} onPress={() => setRole('admin')} />
      </View>
      {invite.isError ? (
        <Text variant="caption" color="negative">
          {errMsg(invite.error, 'Could not send the invite.')}
        </Text>
      ) : null}
      {sentTo ? (
        <Text variant="caption" color="positive">
          Invite emailed to {sentTo}. It expires in 7 days.
        </Text>
      ) : null}
      <Button
        label="Send invite"
        variant="primary"
        loading={invite.isPending}
        onPress={() => {
          setTouched(true);
          const value = email.trim();
          if (!EMAIL_RE.test(value)) return;
          invite.mutate({ email: value, role }, { onSuccess: () => { setSentTo(value); setEmail(''); setTouched(false); } });
        }}
      />
    </Card>
  );
}

/** Members & team (architecture doc §7.17). Role gates mirror the backend; see utils/memberActions. */
export default function WorkspaceMembers() {
  const theme = useTheme();
  const router = useRouter();
  const me = useMe();
  const role = useActiveRole();
  const canManage = role === 'owner' || role === 'admin';
  const members = useWorkspaceMembers();
  const team = useTeamProgress(canManage);
  const remove = useRemoveMember();
  const setRole = useSetMemberRole();
  const transfer = useTransferOwnership();
  const [actionError, setActionError] = useState<string | null>(null);
  const items = members.data?.pages.flatMap((p) => p.items) ?? [];

  const run = async (m: MemberListItem, action: MemberAction) => {
    setActionError(null);
    const name = m.users.display_name ?? m.users.email;
    const onError = (e: unknown) => setActionError(errMsg(e, 'That did not work. Please try again.'));
    if (action === 'remove') {
      if (await confirmAsync(`Remove ${name}?`, 'They lose access to this workspace immediately.', 'Remove', true)) remove.mutate(m.id, { onError });
    } else if (action === 'transfer') {
      if (await confirmAsync(`Make ${name} the owner?`, 'You become an admin. Only the owner can manage billing cancellation and roles.', 'Transfer', true)) transfer.mutate(m.user_id, { onError });
    } else {
      setRole.mutate({ memberId: m.id, role: action === 'make_admin' ? 'admin' : 'member' }, { onError });
    }
  };

  const ACTION_LABEL: Record<MemberAction, string> = { make_admin: 'Make admin', make_member: 'Make member', transfer: 'Transfer ownership', remove: 'Remove' };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <View style={{ padding: theme.layout.screenPaddingPhone, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="title">Team</Text>
        <Button label="Back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/settings/account'))} />
      </View>
      <View style={{ flex: 1 }}>
        <AsyncBoundary isLoading={members.isPending} isError={members.isError} error={members.error} onRetry={() => void members.refetch()} skeletonVariant="card">
          <FlatList
            data={items}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, paddingTop: 0, gap: theme.spacing.md }}
            ListHeaderComponent={
              <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.sm }}>
                {canManage && team.data ? (
                  <Card style={{ gap: 2 }}>
                    <Text variant="caption" color="secondary">
                      Team average
                    </Text>
                    <Text variant="title">{team.data.teamAverage == null ? '—' : Math.round(team.data.teamAverage)}</Text>
                    <Text variant="caption" color="tertiary">
                      across {team.data.memberCount} member{team.data.memberCount === 1 ? '' : 's'} with recent sessions
                    </Text>
                  </Card>
                ) : null}
                {canManage ? <InviteForm /> : null}
                {actionError ? (
                  <Text variant="caption" color="negative">
                    {actionError}
                  </Text>
                ) : null}
              </View>
            }
            renderItem={({ item }) => {
              const name = item.users.display_name ?? item.users.email;
              const actions = memberActions(role, me.data?.id, item);
              return (
                <Card style={{ gap: theme.spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                    <Avatar name={name} />
                    <View style={{ flex: 1 }}>
                      <Text variant="heading" numberOfLines={1}>
                        {name}
                        {item.user_id === me.data?.id ? ' (you)' : ''}
                      </Text>
                      <Text variant="caption" color="tertiary" numberOfLines={1}>
                        {item.users.email}
                      </Text>
                    </View>
                    <Badge label={item.status === 'invited' ? 'Invited' : item.role} tone={item.role === 'owner' ? 'accent' : 'neutral'} />
                  </View>
                  {actions.length > 0 ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                      {actions.map((a) => (
                        <Button key={a} label={ACTION_LABEL[a]} variant={a === 'remove' ? 'destructive' : 'secondary'} onPress={() => void run(item, a)} />
                      ))}
                    </View>
                  ) : null}
                </Card>
              );
            }}
            onEndReached={() => {
              if (members.hasNextPage && !members.isFetchingNextPage) void members.fetchNextPage();
            }}
            onEndReachedThreshold={0.4}
          />
        </AsyncBoundary>
      </View>
    </SafeAreaView>
  );
}
