import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '@/api/queryClient';
import { useGateState } from '@/hooks/useGateState';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  useFonts,
} from '@/theme/fonts';

import { SplashScreenGate } from './_splashScreenGate';

// Required once at module scope for the Google OAuth web flow (§hooks/useGoogleSignIn)
// to resolve its promise correctly when the auth popup redirects back — a
// no-op on native, per expo-web-browser's own docs.
WebBrowser.maybeCompleteAuthSession();

function RootStack() {
  const theme = useTheme();
  const gate = useGateState();

  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg.canvas },
        }}
      >
        {/* Route guards re-evaluate on every gate-state change, so login,
            logout, a failed refresh, or a deleted account move the user
            between groups from wherever they are. A guarded-out route
            falls back to `index`, which redirects to the right place.
            (Replaces the architecture doc's one-shot (auth-gate) group,
            which could not react after its initial redirect.) */}
        <Stack.Protected guard={gate.kind === 'public' || gate.kind === 'unverified'}>
          <Stack.Screen name="(public)" />
        </Stack.Protected>
        <Stack.Protected guard={false}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        <Stack.Protected guard={gate.kind === 'app'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Screen name="index" />
        <Stack.Screen name="gallery" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  const hydrateAuth = useAuthStore((state) => state.hydrate);
  const hydrateWorkspace = useWorkspaceStore((state) => state.hydrate);
  const [storesHydrated, setStoresHydrated] = useState(false);

  useEffect(() => {
    Promise.all([hydrateAuth(), hydrateWorkspace()]).then(() => setStoresHydrated(true));
  }, [hydrateAuth, hydrateWorkspace]);

  const ready = (fontsLoaded || !!fontError) && storesHydrated;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <SplashScreenGate ready={ready}>
              <RootStack />
            </SplashScreenGate>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
