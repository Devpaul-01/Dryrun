import { Stack, useRouter } from 'expo-router';
import React, { useEffect } from 'react';

import { usePushRegistration, usePushRouting } from '@/hooks/usePushRouting';
import { useSessionRecovery } from '@/hooks/useSessionRecovery';
import { useMe } from '@/hooks/useAuth';
import { usePendingInviteStore } from '@/stores/pendingInviteStore';
import { usePendingRouteStore } from '@/stores/pendingRouteStore';

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
  // A converted demo lands on its (now real) session once the matching account first signs in.
  const me = useMe();
  const pendingRoute = usePendingRouteStore();
  useEffect(() => {
    if (!pendingRoute.hydrated) void pendingRoute.hydrate();
  }, [pendingRoute.hydrated]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = pendingRoute.pending;
    if (!p || !me.data?.email) return;
    if (p.email.toLowerCase() !== me.data.email.toLowerCase()) return;
    void pendingRoute.clear();
    router.push(p.path as never);
  }, [pendingRoute.pending, me.data?.email]); // eslint-disable-line react-hooks/exhaustive-deps
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
