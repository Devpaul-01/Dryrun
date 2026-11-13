import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';

import * as authApi from '@/api/auth';
import { supabase } from '@/lib/supabaseClient';
import { useAuthStore } from '@/stores/authStore';

/**
 * Google sign-in via Supabase's hosted OAuth + PKCE (architecture doc
 * §7.1, §11; backend auth.routes.ts's own comment on /google/start:
 * "Mobile clients do not hit this route ... use expo-auth-session directly
 * against Supabase Auth's OAuth endpoint with a platform-computed redirect
 * URI"). Flow:
 *
 * 1. supabase.auth.signInWithOAuth({ skipBrowserRedirect: true }) builds
 *    the Supabase-hosted authorize URL and stores the PKCE verifier
 *    locally (pkce flowType on the client, §lib/supabaseClient.ts).
 * 2. expo-web-browser opens that URL in an auth session, closing itself
 *    once the browser redirects to our dryrun://auth-callback scheme
 *    (matches the backend's GOOGLE_OAUTH_MOBILE_REDIRECT_SCHEME exactly).
 * 3. The redirect URL's `code` param is exchanged for a Supabase session
 *    via exchangeCodeForSession (verifier already stored from step 1).
 * 4. That session's tokens are persisted as this app's own auth tokens
 *    (the Supabase session *is* the DryRun session post-login — the
 *    backend validates the same Supabase-issued JWT httpClient already
 *    sends on every request), then POST /auth/google/callback runs
 *    fire-and-forget to finalize profile/workspace provisioning
 *    server-side exactly once for this identity.
 */
export function useGoogleSignIn() {
  const setTokens = useAuthStore((state) => state.setTokens);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const signIn = useCallback(async () => {
    if (!supabase) {
      setError(new Error('Google sign-in is not configured for this build.'));
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      const redirectTo = AuthSession.makeRedirectUri({ path: 'auth-callback' });

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (oauthError || !data.url) {
        throw new Error(oauthError?.message ?? 'Could not start Google sign-in.');
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

      if (result.type === 'cancel' || result.type === 'dismiss') {
        return; // user backed out — not an error state
      }
      if (result.type !== 'success') {
        throw new Error('Google sign-in did not complete.');
      }

      const redirectUrl = new URL(result.url);
      const code = redirectUrl.searchParams.get('code');
      const oauthErrorParam = redirectUrl.searchParams.get('error_description');
      if (oauthErrorParam) {
        throw new Error(oauthErrorParam);
      }
      if (!code) {
        throw new Error('Google sign-in did not return an authorization code.');
      }

      const { data: sessionData, error: exchangeError } =
        await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError || !sessionData.session) {
        throw new Error(exchangeError?.message ?? 'Could not complete Google sign-in.');
      }

      const { access_token, refresh_token, expires_at } = sessionData.session;
      await setTokens({
        accessToken: access_token,
        refreshToken: refresh_token,
        // Supabase gives expires_at as a unix seconds timestamp; the rest
        // of this app (AuthSession/RefreshResponse) uses an ISO string.
        expiresAt: expires_at
          ? new Date(expires_at * 1000).toISOString()
          : new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      // Fire-and-forget finalize: provisions the profile/workspace row and
      // sends the verification email exactly once for this identity. Not
      // awaited into the UI's critical path — a failure here shouldn't
      // block the user from landing in the app; the auth-gate's own
      // GET /auth/me will still reflect whatever state the backend is in.
      authApi.googleCallback({ access_token }).catch(() => {
        // Intentionally swallowed — see comment above.
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Google sign-in failed.'));
    } finally {
      setIsPending(false);
    }
  }, [setTokens]);

  return { signIn, isPending, error };
}
