import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { useResendVerification } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * "Check your email" instruction screen — the user-decided fallback for
 * the fact that email verification and password reset are currently
 * fulfilled by the backend's own hosted web pages (webLinks.routes.ts),
 * not an app deep link (architecture doc §11 gap, confirmed against
 * backend source; FRONTEND_URL_MOBILE_SCHEME exists but is unused by this
 * flow today). This screen sets expectations rather than making the app
 * pretend it will hand control back automatically.
 *
 * Reached from two contexts (?context=signup|reset) which only change the
 * copy — the underlying wait is the same in both cases.
 */
export default function CheckEmail() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; context?: string }>();
  const isSignupContext = params.context !== 'reset';
  const hasTokens = useAuthStore((state) => state.tokens !== null);
  const resend = useResendVerification();
  const [resendSent, setResendSent] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg.canvas }}>
      <View
        style={{
          flex: 1,
          padding: theme.layout.screenPaddingPhone,
          justifyContent: 'center',
          gap: theme.spacing.lg,
        }}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="title">Check your email</Text>
          <Text variant="body" color="secondary">
            {isSignupContext
              ? 'We sent a verification link to'
              : 'We sent a password reset link to'}
            {params.email ? ` ${params.email}` : ' your inbox'}. Open it on this device to{' '}
            {isSignupContext ? 'verify your account' : 'set a new password'}, then come back
            here.
          </Text>
        </View>

        {/* Resend only applies to the signup/verification context, and only
            when the user is actually authenticated — resend-verification is
            an authenticated endpoint (one of the few EMAIL_NOT_VERIFIED-exempt
            routes), so it's unreachable before a session exists. A user who
            just signed up has no session yet; this mainly helps someone who
            logged in and landed here from the auth-gate. */}
        {isSignupContext && hasTokens ? (
          <Button
            label={resendSent ? 'Email sent' : 'Resend verification email'}
            variant="secondary"
            fullWidth
            loading={resend.isPending}
            disabled={resendSent}
            onPress={() => resend.mutate(undefined, { onSuccess: () => setResendSent(true) })}
          />
        ) : null}

        <Button
          label="Back to log in"
          variant="ghost"
          fullWidth
          onPress={() => router.replace('/(public)/login')}
        />
      </View>
    </SafeAreaView>
  );
}
