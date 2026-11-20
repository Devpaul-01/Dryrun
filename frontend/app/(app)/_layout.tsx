import { Stack, useRouter } from 'expo-router';
import React, { useEffect } from 'react';

import { usePushRegistration, usePushRouting } from '@/hooks/usePushRouting';
import { useSessionRecovery } from '@/hooks/useSessionRecovery';
import { usePendingInviteStore } from '@/stores/pendingInviteStore';

/**
 * Authenticated, workspace-resolved shell (architecture doc §6). (tabs) is
 * the bottom-tab home; everything else here (session, persona, playbook,
 * workspace, billing, settings, notifications) stack-presents over it.
 */
export default function AppLayout() {
  useSessionRecovery();
  usePushRouting();
  usePushRegistration();
  const router = useRouter();
  const { token, hydrated, hydrate } = usePendingInviteStore();
  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);
  // An invite opened while signed out resumes here once the user is in the app.
  useEffect(() => {
    if (token) router.push({ pathname: '/invites/accept', params: { token } });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="session/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="session/[id]/live" />
      <Stack.Screen name="session/[id]/ending" options={{ gestureEnabled: false }} />
      <Stack.Screen name="session/[id]/debrief" />
      <Stack.Screen name="session/[id]/replay" />
      <Stack.Screen name="session/[id]/comparison" />
      <Stack.Screen name="persona/index" />
      <Stack.Screen name="persona/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="persona/[id]" />
      <Stack.Screen name="playbooks/index" />
      <Stack.Screen name="playbooks/[id]" />
      <Stack.Screen name="workspace/index" />
      <Stack.Screen name="workspace/settings" />
      <Stack.Screen name="billing/plans" />
      <Stack.Screen name="billing/subscription" />
      <Stack.Screen name="billing/invoices" />
      <Stack.Screen name="settings/profile" />
      <Stack.Screen name="settings/notifications" />
      <Stack.Screen name="settings/account" />
      <Stack.Screen name="notifications/index" />
    </Stack>
  );
}
