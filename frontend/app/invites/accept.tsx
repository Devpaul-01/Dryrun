import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text } from '@/components/ui';
import { useGateState } from '@/hooks/useGateState';
import { useAcceptInvite } from '@/hooks/useWorkspaces';
import { usePendingInviteStore } from '@/stores/pendingInviteStore';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';

/**
 * Workspace invite deep link (`dryrun://invites/accept?token=…`, same path as the
 * emailed web link). Signed out: remember the token and send the user to log in.
 * Signed in: accept it, switch into the workspace, go home.
 */
export default function AcceptInvite() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const gate = useGateState();
  const pending = usePendingInviteStore();
  const token = params.token || pending.token;
  const accept = useAcceptInvite();
  const started = useRef(false);

  // Keep the token across the login detour.
  useEffect(() => {
    if (params.token && gate.kind === 'public') void pending.set(params.token);
  }, [params.token, gate.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (gate.kind !== 'app' || !token || started.current) return;
    started.current = true;
    accept.mutate(token, {
      onSettled: () => void pending.clear(),
      onSuccess: () => router.replace('/(app)/(tabs)/home'),
    });
  }, [gate.kind, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const message = accept.isError
    ? isApiException(accept.error) && accept.error.status === 400
      ? 'This invite is invalid or has expired. Ask your teammate to send a new one.'
      : 'Something went wrong accepting the invite. Please try again.'
    : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas, justifyContent: 'center' }}>
      <View style={{ padding: theme.layout.screenPaddingPhone }}>
        <Card style={{ gap: theme.spacing.md }}>
          {!token ? (
            <>
              <Text variant="heading">No invite found</Text>
              <Text variant="body" color="secondary">
                Open the invite link from your email on this device.
              </Text>
              <Button label="Continue" variant="secondary" onPress={() => router.replace('/')} />
            </>
          ) : gate.kind === 'public' ? (
            <>
              <Text variant="heading">You&apos;re invited</Text>
              <Text variant="body" color="secondary">
                Log in or create an account with the email the invite was sent to, and we&apos;ll add you to the workspace.
              </Text>
              <Button label="Log in" variant="primary" fullWidth onPress={() => router.push('/(public)/login')} />
              <Button label="Create account" variant="secondary" fullWidth onPress={() => router.push('/(public)/signup')} />
            </>
          ) : message ? (
            <>
              <Text variant="heading" color="negative">
                Couldn&apos;t join
              </Text>
              <Text variant="body" color="secondary">
                {message}
              </Text>
              <Button label="Go to DryRun" variant="secondary" onPress={() => router.replace('/(app)/(tabs)/home')} />
            </>
          ) : (
            <>
              <Text variant="heading">Joining workspace…</Text>
              <Text variant="body" color="secondary">
                One moment.
              </Text>
            </>
          )}
        </Card>
      </View>
    </SafeAreaView>
  );
}
