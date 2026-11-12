import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text, TextField } from '@/components/ui';
import { useLogin } from '@/hooks/useAuth';
import { useTheme } from '@/theme/ThemeProvider';
import { isAccountDeletedException, isApiException } from '@/types/errors';
import { validateEmail } from '@/utils/authValidation';

/**
 * Login (architecture doc §7.1): email/password form, inline validation,
 * error banner for 401/409-class failures. Google sign-in button lands
 * alongside signup's once expo-auth-session wiring is in (M1, same pass).
 */
export default function Login() {
  const theme = useTheme();
  const router = useRouter();
  const login = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const emailError = touched ? validateEmail(email) : undefined;
  const passwordError = touched ? (password ? undefined : 'Password is required') : undefined;

  const errorMessage = (() => {
    if (!login.isError) return undefined;
    const err = login.error;
    if (isAccountDeletedException(err)) {
      return 'This account was deleted. Contact support to recover it.';
    }
    if (isApiException(err)) {
      return err.body?.message ?? 'Something went wrong. Please try again.';
    }
    return 'Something went wrong. Please try again.';
  })();

  function handleSubmit() {
    setTouched(true);
    const eErr = validateEmail(email);
    if (eErr || !password) return;
    login.mutate({ email: email.trim(), password });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: theme.layout.screenPaddingPhone,
          justifyContent: 'center',
          gap: theme.spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title">Welcome back</Text>
          <Text variant="body" color="secondary">
            Log in to pick up where you left off.
          </Text>
        </View>

        {errorMessage ? (
          <Card style={{ backgroundColor: theme.colors.bg.elevated, borderColor: theme.colors.signal.negative }}>
            <Text variant="caption" color="negative">
              {errorMessage}
            </Text>
          </Card>
        ) : null}

        <View style={{ gap: theme.spacing.md }}>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            error={emailError}
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            error={passwordError}
          />
        </View>

        <Button
          label="Log in"
          variant="primary"
          fullWidth
          loading={login.isPending}
          onPress={handleSubmit}
        />

        <Button
          label="Forgot password?"
          variant="ghost"
          fullWidth
          onPress={() => router.push('/(public)/forgot-password')}
        />

        <Button
          label="Don't have an account? Sign up"
          variant="ghost"
          fullWidth
          onPress={() => router.replace('/(public)/signup')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
