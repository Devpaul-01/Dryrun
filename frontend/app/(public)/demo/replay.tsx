import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDemoReplay } from '@/api/demo';
import { ChatBubble } from '@/components/simulation/ChatBubble';
import { AsyncBoundary, Button, Card, Text, TextField } from '@/components/ui';
import { useConvertDemo } from '@/hooks/useDemo';
import { useDemoStore } from '@/stores/demoStore';
import { usePendingRouteStore } from '@/stores/pendingRouteStore';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';
import { validateEmail, validatePassword } from '@/utils/authValidation';

/** Demo replay + the persistent "save this" bridge into a real account (architecture doc §7.17). */
export default function DemoReplay() {
  const theme = useTheme();
  const router = useRouter();
  const token = useDemoStore((s) => s.token);
  const reset = useDemoStore((s) => s.reset);
  const setPending = usePendingRouteStore((s) => s.set);
  const replay = useQuery({ queryKey: ['demo-replay', token], queryFn: () => getDemoReplay(token as string), enabled: !!token });
  const convert = useConvertDemo();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const emailError = touched ? validateEmail(email.trim()) : undefined;
  const passwordError = touched ? validatePassword(password) : undefined;

  const submit = () => {
    setTouched(true);
    if (!token || validateEmail(email.trim()) || validatePassword(password)) return;
    const address = email.trim();
    convert.mutate(
      { token, email: address, password },
      {
        onSuccess: async (res) => {
          // The account needs email verification before login, so remember where to land afterwards.
          await setPending({ email: address, path: `/(app)/session/${res.sessionId}/replay` });
          reset();
          router.replace({ pathname: '/(public)/check-email', params: { email: address, context: 'signup' } });
        },
      },
    );
  };

  const convertError = convert.isError
    ? isApiException(convert.error)
      ? (convert.error.body?.message ?? 'Could not create your account.')
      : 'Could not create your account. Please try again.'
    : null;

  if (!token) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas, justifyContent: 'center', padding: theme.layout.screenPaddingPhone }}>
        <Card style={{ gap: theme.spacing.md }}>
          <Text variant="heading">Demo not found</Text>
          <Text variant="body" color="secondary">
            Demos can&apos;t be reopened after you leave. Start a new one, or create an account to keep your practice.
          </Text>
          <Button label="Start a demo" variant="primary" onPress={() => router.replace('/(public)/demo/start')} />
          <Button label="Create account" variant="secondary" onPress={() => router.replace('/(public)/signup')} />
        </Card>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView contentContainerStyle={{ padding: theme.layout.screenPaddingPhone, gap: theme.spacing.lg }} keyboardShouldPersistTaps="handled">
        <Text variant="title">Your demo conversation</Text>

        <AsyncBoundary isLoading={replay.isPending} isError={replay.isError} error={replay.error} onRetry={() => void replay.refetch()} skeletonVariant="card">
          <View style={{ gap: theme.spacing.sm }}>
            {(replay.data?.messages ?? []).map((m, i) => (
              <ChatBubble key={i} item={{ localId: String(i), role: m.role, content: m.content, status: 'sent' }} buyerName={replay.data?.persona.name} />
            ))}
          </View>
        </AsyncBoundary>

        <Card style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">Save this and keep practicing</Text>
          <Text variant="body" color="secondary">
            Create a free account and this conversation moves into it, with a skill debrief and unlimited-length practice.
          </Text>
          <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={emailError} />
          <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" error={passwordError} />
          {convertError ? (
            <Text variant="caption" color="negative">
              {convertError}
            </Text>
          ) : null}
          <Button label="Create account" variant="primary" fullWidth loading={convert.isPending} onPress={submit} />
        </Card>

        <Button label="Try another demo" variant="ghost" fullWidth onPress={() => { reset(); router.replace('/(public)/demo/start'); }} />
      </ScrollView>
    </SafeAreaView>
  );
}
