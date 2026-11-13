import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Text, TextField } from '@/components/ui';
import { GoogleIcon } from '@/components/ui/icons';
import { useSignup } from '@/hooks/useAuth';
import { useGoogleSignIn } from '@/hooks/useGoogleSignIn';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';
import { validateEmail, validatePassword } from '@/utils/authValidation';

/**
 * Signup (architecture doc §7.1). POST /auth/signup returns no session
 * (src/types/auth.ts's SignupResponse: {success, user_id, message}, not a
 * token pair) — Supabase requires email confirmation before a session is
 * issued, so this routes to check-email rather than attempting a login.
 */
export default function Signup() {
  const theme = useTheme();
  const router = useRouter();
  const signup = useSignup();
  const googleSignIn = useGoogleSignIn();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const emailError = touched ? validateEmail(email) : undefined;
  const passwordError = touched ? validatePassword(password) : undefined;

  const errorMessage = (() => {
    if (googleSignIn.error) return googleSignIn.error.message;
    if (!signup.isError) return undefined;
    const err = signup.error;
    if (isApiException(err)) {
      return err.body?.message ?? 'Something went wrong. Please try again.';
    }
    return 'Something went wrong. Please try again.';
  })();

  function handleSubmit() {
    setTouched(true);
    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    if (eErr || pErr) return;

    signup.mutate(
      {
        email: email.trim(),
        password,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      },
      {
        onSuccess: () => {
          router.replace({
            pathname: '/(public)/check-email',
            params: { email: email.trim(), context: 'signup' },
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
          <Text variant="title">Create your account</Text>
          <Text variant="body" color="secondary">
            Start rehearsing in minutes.
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
            label="Name (optional)"
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
            autoComplete="name"
          />
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
            autoComplete="password-new"
            error={passwordError}
          />
        </View>

        <Button
          label="Create account"
          variant="primary"
          fullWidth
          loading={signup.isPending}
          onPress={handleSubmit}
        />

        <Button
          label="Continue with Google"
          variant="secondary"
          fullWidth
          icon={<GoogleIcon />}
          loading={googleSignIn.isPending}
          onPress={googleSignIn.signIn}
        />

        <Button
          label="Already have an account? Log in"
          variant="ghost"
          fullWidth
          onPress={() => router.replace('/(public)/login')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
