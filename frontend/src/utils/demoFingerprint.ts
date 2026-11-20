import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const KEY = 'dryrun.demo.fingerprint';

/** A random per-install id (1–200 chars required by the backend); not derived from any device identifier. */
export async function getDemoFingerprint(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = Crypto.randomUUID();
    await AsyncStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return Crypto.randomUUID();
  }
}
