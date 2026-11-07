import { defineConfig } from 'vitest/config';

// Quiets pino's real log output during test runs -- the AI-retry suite
// deliberately exercises ai.service.ts's own log.warn/log.error calls
// (that's what proves the retry path actually ran), which would
// otherwise print a wall of JSON on every test invocation.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20000, // the billing suite spins up a real Postgres DB and replays every migration
    hookTimeout: 20000,
    // Runs the billing-reconciliation suite's real-Postgres setup/teardown
    // sequentially across files to avoid two files racing to
    // create/drop the same TEST_DB_NAME database concurrently.
    fileParallelism: false,
  },
});
