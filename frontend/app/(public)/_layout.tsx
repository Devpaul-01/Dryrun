import { Stack } from 'expo-router';
import React from 'react';

export default function PublicLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="reset-password/[token]" />
      <Stack.Screen name="verify-email/[token]" />
      <Stack.Screen name="demo/start" />
      <Stack.Screen name="demo/session" />
      <Stack.Screen name="demo/replay" />
      <Stack.Screen name="playbook/[token]" />
    </Stack>
  );
}
