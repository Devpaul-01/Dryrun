import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { ME_QUERY_KEY, useVerifyEmail } from '@/hooks/useAuth';
import { useTheme } from '@/theme/ThemeProvider';
import { isApiException } from '@/types/errors';

/**
 * Deep-link target for email verification (dryrun://verify-email/<token>).
 * Today the backend fulfils verification through its own hosted web page
 * (webLinks.routes.ts), so real emails don't land here yet — this screen
 * is built for when the mobile-scheme link is switched on (see the
 * check-email screen's header comment). It submits the token once on
 * mount, then hands control back to the auth gate, which re-reads
 * GET /auth/me and routes accordingly.
 */
export default function VerifyEmail() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { token } = useLocalSearchParams<{ token: string }>();
  const verify = useVerifyEmail();
  const submitted = useRef(false);

  useEffect(() => {
    if (!token || submitted.current) return;
    submitted.current = true;
    verify.mutate(
      { token },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
        },
      },
    );
  }, [token, verify, queryClient]);

  const errorMessage = verify.isError
    ? isApiException(verify.error)
      ? (verify.error.body?.message ?? 'This verification link is invalid or has expired.')
      : 'Something went wrong. Please try again.'
    : undefined;

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
        {verify.isSuccess ? (
          <>
            <Text variant="title">Email verified</Text>
            <Text variant="body" color="secondary">
              You&apos;re all set. Continue to DryRun.
            </Text>
            <Button label="Continue" variant="primary" fullWidth onPress={() => router.replace('/')} />
          </>
        ) : errorMessage ? (
          <>
            <Text variant="title">Couldn&apos;t verify your email</Text>
            <Text variant="body" color="secondary">
              {errorMessage}
            </Text>
            <Button
              label="Back to log in"
              variant="secondary"
              fullWidth
              onPress={() => router.replace('/(public)/login')}
            />
          </>
        ) : (
          <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <ActivityIndicator color={theme.colors.accent.primary} />
            <Text variant="body" color="secondary">
              Verifying your email…
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
