/* global jest */
// CommonJS on purpose: setupFiles (unlike setupFilesAfterEnv's TS/ESM
// entry) runs before the test framework and any test module's own
// imports are evaluated, so process.env is guaranteed to be populated
// before src/config/env.ts is ever imported — including transitively via
// jest.setup.ts -> test/mocks/server.ts -> handlers -> env.ts.
process.env.EXPO_PUBLIC_API_BASE_URL ??= 'http://localhost:3001';

// Same ordering reason: the AsyncStorage native-module mock must be
// registered before any test file's own (hoisted) imports pull in
// src/stores/workspaceStore.ts, which setupFilesAfterEnv is too late for.
// The package's mock file only exports a mock object — it doesn't call
// jest.mock() itself — so that's done explicitly here.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-secure-store has no official Jest mock, and jest-expo's own
// auto-mock is a no-op stub (every call resolves to undefined, nothing is
// actually stored) — confirmed by probing it directly, which is NOT safe
// enough to test authStore's restart-persistence behavior against (see
// test/stores/authStore.test.ts). A minimal real in-memory implementation,
// matching the AsyncStorage mock's approach above.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
  };
});
