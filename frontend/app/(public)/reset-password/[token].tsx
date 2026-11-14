import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text, TextField } from '@/components/ui';
import { useResetPassword } from '@/hooks/useAuth';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';
import { validatePassword } from '@/utils/authValidation';

/**
 * Deep-link target for password reset (dryrun://reset-password/<token>).
 * Like verify-email, built ahead of the backend switching its emailed
 * links from hosted web pages to the mobile scheme.
 */
export default function ResetPassword() {
  const theme = useTheme();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const reset = useResetPassword();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);

  const passwordError = touched ? validatePassword(password) : undefined;
  const confirmError =
    touched && !passwordError && confirm !== password ? 'Passwords do not match' : undefined;

  const errorMessage = reset.isError
    ? isApiException(reset.error)
      ? (reset.error.body?.message ?? 'This reset link is invalid or has expired.')
      : 'Something went wrong. Please try again.'
    : undefined;

  function handleSubmit() {
    setTouched(true);
    if (!token || validatePassword(password) || confirm !== password) return;
    reset.mutate({ token, newPassword: password });
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
        {reset.isSuccess ? (
          <View style={{ gap: theme.spacing.lg }}>
            <Text variant="title">Password updated</Text>
            <Text variant="body" color="secondary">
              Log in with your new password.
            </Text>
            <Button
              label="Log in"
              variant="primary"
              fullWidth
              onPress={() => router.replace('/(public)/login')}
            />
          </View>
        ) : (
          <>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="title">Set a new password</Text>
              <Text variant="body" color="secondary">
                Choose a password of 8–72 characters.
              </Text>
            </View>

            {errorMessage ? (
              <Card
                style={{
                  backgroundColor: theme.colors.bg.elevated,
                  borderColor: theme.colors.signal.negative,
                }}
              >
                <Text variant="caption" color="negative">
                  {errorMessage}
                </Text>
              </Card>
            ) : null}

            <View style={{ gap: theme.spacing.md }}>
              <TextField
                label="New password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password-new"
                error={passwordError}
              />
              <TextField
                label="Confirm password"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password-new"
                error={confirmError}
              />
            </View>

            <Button
              label="Update password"
              variant="primary"
              fullWidth
              loading={reset.isPending}
              onPress={handleSubmit}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
