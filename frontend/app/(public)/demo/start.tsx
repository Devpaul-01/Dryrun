import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { DemoCategory } from '@/api/demo';
import { Button, Card, Text } from '@/components/ui';
import { useStartDemo } from '@/hooks/useDemo';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';

const CATEGORIES: { key: DemoCategory; title: string; blurb: string }[] = [
  { key: 'saas', title: 'Software / SaaS', blurb: 'Pitch a project tool to a busy operations manager.' },
  { key: 'services', title: 'Services', blurb: 'Sell marketing consulting to a small-business owner.' },
  { key: 'physical_product', title: 'Physical product', blurb: 'Sell a coffee subscription to a coffee enthusiast.' },
];

/** Demo entry (architecture doc §7.17): pick a category, meet a buyer, no account needed. */
export default function DemoStart() {
  const theme = useTheme();
  const router = useRouter();
  const start = useStartDemo();
  const [category, setCategory] = useState<DemoCategory>('saas');
  const limited = start.isError && isApiException(start.error) && start.error.status === 429;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title">Try a practice conversation</Text>
          <Text variant="body" color="secondary">
            Chat with an AI buyer for up to 8 messages. No account needed.
          </Text>
        </View>

        <View style={{ gap: theme.spacing.md }}>
          {CATEGORIES.map((c) => {
            const selected = c.key === category;
            return (
              <Pressable key={c.key} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setCategory(c.key)}>
                <Card style={{ gap: 4, borderColor: selected ? theme.colors.accent.primary : undefined }}>
                  <Text variant="heading">{c.title}</Text>
                  <Text variant="body" color="secondary">
                    {c.blurb}
                  </Text>
                </Card>
              </Pressable>
            );
          })}
        </View>

        {start.isError ? (
          <Card style={{ gap: theme.spacing.sm, borderColor: theme.colors.signal.negative }}>
            <Text variant="body" color={limited ? 'secondary' : 'negative'}>
              {limited ? "You've already tried a demo today. Create a free account to keep practicing." : "We couldn't start the demo. Please try again."}
            </Text>
            {limited ? <Button label="Create free account" variant="primary" onPress={() => router.push('/(public)/signup')} /> : null}
          </Card>
        ) : null}

        <Button
          label="Start the demo"
          variant="primary"
          fullWidth
          loading={start.isPending}
          onPress={() => start.mutate(category, { onSuccess: () => router.replace('/(public)/demo/session') })}
        />
        <Button label="Back" variant="ghost" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/(public)/welcome'))} />
      </ScrollView>
    </SafeAreaView>
  );
}
