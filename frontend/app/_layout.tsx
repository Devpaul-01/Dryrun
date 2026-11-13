import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { queryClient } from '@/api/queryClient';
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

  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg.canvas },
        }}
      />
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
