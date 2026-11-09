import { Tabs } from 'expo-router';
import React from 'react';

import { ClockIcon, HomeIcon, TargetIcon, TrendIcon } from '@/components/ui/icons';
import { useTheme } from '@/theme/ThemeProvider';

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent.primary,
        tabBarInactiveTintColor: theme.colors.content.tertiary,
        tabBarStyle: {
          backgroundColor: theme.colors.bg.surface,
          borderTopColor: theme.colors.border.subtle,
        },
        tabBarLabelStyle: theme.typography.micro,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <HomeIcon color={color ?? theme.colors.content.tertiary} />,
        }}
      />
      <Tabs.Screen
        name="practice"
        options={{
          title: 'Practice',
          tabBarIcon: ({ color }) => <TargetIcon color={color ?? theme.colors.content.tertiary} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => <ClockIcon color={color ?? theme.colors.content.tertiary} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarIcon: ({ color }) => <TrendIcon color={color ?? theme.colors.content.tertiary} />,
        }}
      />
    </Tabs>
  );
}
