import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * expo-secure-store has no web implementation — SecureStore.getItemAsync
 * etc. throw "is not a function" at runtime on web (there is no Keychain/
 * Keystore equivalent in a browser), even though it type-checks fine on
 * every platform. DryRun's real targets are iOS/Android, but `expo start
 * --web` is still how this runs in CI and in a quick browser preview, so
 * this thin adapter keeps every other call site platform-agnostic: native
 * SecureStore where it exists, localStorage (explicitly NOT a secure
 * store — web preview/dev convenience only, never production-sensitive
 * on that platform) otherwise.
 */

async function webGetItemAsync(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

async function webSetItemAsync(key: string, value: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Ignore (e.g. storage disabled/full) — matches SecureStore's own
    // fire-and-forget error shape for this adapter's callers.
  }
}

async function webDeleteItemAsync(key: string): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Ignore, see webSetItemAsync.
  }
}

export const secureStorage = {
  getItemAsync: Platform.OS === 'web' ? webGetItemAsync : SecureStore.getItemAsync,
  setItemAsync: Platform.OS === 'web' ? webSetItemAsync : SecureStore.setItemAsync,
  deleteItemAsync: Platform.OS === 'web' ? webDeleteItemAsync : SecureStore.deleteItemAsync,
};
