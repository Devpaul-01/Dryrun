import { Stack } from 'expo-router';
import React from 'react';

import { contentColumn } from '@/utils/responsive';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: contentColumn() }}>
      <Stack.Screen name="instant-setup" />
    </Stack>
  );
}
