import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { Button, ScreenPlaceholder } from '@/components/ui';

/**
 * Placeholder until the dashboard lands (M2/M3). The Account button is a
 * temporary entry point so the workspace switcher and log out are
 * reachable now; it is replaced by the real header/profile entry then.
 */
export default function Screen_Home() {
  const router = useRouter();
  return (
    <View style={{ flex: 1 }}>
      <ScreenPlaceholder title="Home" milestone="M3 — Dashboard" />
      <View style={{ padding: 16 }}>
        <Button label="Account" variant="secondary" fullWidth onPress={() => router.push('/(app)/settings/account')} />
      </View>
    </View>
  );
}
