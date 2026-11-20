import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatBubble } from '@/components/simulation/ChatBubble';
import { Composer } from '@/components/simulation/Composer';
import { TypingIndicator } from '@/components/simulation/TypingIndicator';
import { Button, Text } from '@/components/ui';
import { useEndDemo, useSendDemoMessage } from '@/hooks/useDemo';
import { DEMO_MESSAGE_CAP, useDemoStore } from '@/stores/demoStore';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';

/**
 * Anonymous demo conversation. The demo endpoint returns only `reply` and a
 * remaining-messages count (no live meters), so this is a plain chat with a counter.
 */
export default function DemoSession() {
  const theme = useTheme();
  const router = useRouter();
  const { token, persona, messages, remaining } = useDemoStore();
  const send = useSendDemoMessage();
  const end = useEndDemo();
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const done = remaining === 0;

  // No token = deep link / reload with the in-memory demo gone: start over.
  useEffect(() => {
    if (!token) router.replace('/(public)/demo/start');
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, send.isPending]);

  const finish = () => {
    if (!token) return;
    end.mutate(token, { onSettled: () => router.replace('/(public)/demo/replay') });
  };

  const onSend = (content: string): boolean => {
    if (!token || send.isPending || done) return false;
    setError(null);
    send.mutate(
      { token, content },
      {
        onError: (e) => {
          const status = isApiException(e) ? e.status : undefined;
          if (status === 403) finish();
          else if (status === 404) setError('This demo has expired. Start a new one.');
          else setError("That message didn't send. Please try again.");
        },
      },
    );
    return true;
  };

  const items = messages.map((m, i) => ({ localId: String(i), role: m.role, content: m.content, status: 'sent' as const }));
  const left = remaining ?? DEMO_MESSAGE_CAP;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <View style={{ padding: theme.layout.screenPaddingPhone, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={1}>
            {persona?.name ?? 'Buyer'}
          </Text>
          <Text variant="caption" color="secondary" numberOfLines={1}>
            {persona?.role} · {left} message{left === 1 ? '' : 's'} left
          </Text>
        </View>
        <Button label={messages.length > 0 ? 'End & review' : 'Leave'} variant="secondary" loading={end.isPending} onPress={() => (messages.length > 0 ? finish() : router.replace('/(public)/welcome'))} />
      </View>

      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(i) => i.localId}
        contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.sm, flexGrow: 1 }}
        ListEmptyComponent={
          <Text variant="body" color="secondary" style={{ textAlign: 'center', marginTop: theme.spacing.xl }}>
            Say hello — {persona?.name ?? 'your buyer'} is waiting for your opening line.
          </Text>
        }
        renderItem={({ item }) => <ChatBubble item={item} buyerName={persona?.name} />}
        ListFooterComponent={send.isPending ? <TypingIndicator buyerName={persona?.name} /> : undefined}
      />

      {error ? (
        <Text variant="caption" color="negative" style={{ textAlign: 'center', paddingHorizontal: theme.layout.screenPaddingPhone }}>
          {error}
        </Text>
      ) : null}
      {done ? (
        <View style={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.sm }}>
          <Text variant="body" color="secondary" style={{ textAlign: 'center' }}>
            That&apos;s the end of the demo.
          </Text>
          <Button label="See your replay" variant="primary" fullWidth loading={end.isPending} onPress={finish} />
        </View>
      ) : (
        <Composer onSend={onSend} disabled={send.isPending} />
      )}
    </SafeAreaView>
  );
}
