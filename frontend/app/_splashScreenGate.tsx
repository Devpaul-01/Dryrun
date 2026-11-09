import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Safe to ignore — can throw if called more than once (e.g. Fast Refresh).
});

export function SplashScreenGate({
  ready,
  children,
}: {
  ready: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return <>{children}</>;
}
