import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text, TextField } from '@/components/ui';
import { useForgotPassword } from '@/hooks/useAuth';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';
import { validateEmail } from '@/utils/authValidation';

export default function ForgotPassword() {
  const theme = useTheme();
  const router = useRouter();
  const forgotPassword = useForgotPassword();

  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);

  const emailError = touched ? validateEmail(email) : undefined;

  const errorMessage = (() => {
    if (!forgotPassword.isError) return undefined;
    const err = forgotPassword.error;
    if (isApiException(err)) {
      return err.body?.message ?? 'Something went wrong. Please try again.';
    }
    return 'Something went wrong. Please try again.';
  })();

  function handleSubmit() {
    setTouched(true);
    if (validateEmail(email)) return;

    forgotPassword.mutate(
      { email: email.trim() },
      {
        onSuccess: () => {
          router.replace({
            pathname: '/(public)/check-email',
            params: { email: email.trim(), context: 'reset' },
          });
        },
      },
    );
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
          <Text variant="title">Reset your password</Text>
          <Text variant="body" color="secondary">
            We&apos;ll email you a link to set a new password.
          </Text>
        </View>

        {errorMessage ? (
          <Card style={{ backgroundColor: theme.colors.bg.elevated, borderColor: theme.colors.signal.negative }}>
            <Text variant="caption" color="negative">
              {errorMessage}
            </Text>
          </Card>
        ) : null}

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          error={emailError}
        />

        <Button
          label="Send reset link"
          variant="primary"
          fullWidth
          loading={forgotPassword.isPending}
          onPress={handleSubmit}
        />

        <Button label="Back to log in" variant="ghost" fullWidth onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
