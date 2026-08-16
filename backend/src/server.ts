import app from './app';
import { env } from './config/env';
import { createLogger } from './config/logger';
import { shutdownPostHog } from './modules/analytics/posthog.client';

const log = createLogger('server');

const server = app.listen(env.port, () => {
  log.info(`DryRun API listening on port ${env.port} (${env.nodeEnv})`);
});

// FIX (audit finding C4): standalone API-only mode (this file, run via
// `node dist/server.js` per package.json's `start` script — the mode most
// production deployments actually use) previously had no SIGTERM/SIGINT
// handling at all. Every deploy or scale-down event sends SIGTERM; without
// a handler, Node's default behavior terminates immediately, mid-request,
// dropping any in-flight HTTP requests and any buffered-but-unflushed
// PostHog events. This mirrors start-all.ts's existing, correct shutdown
// pattern for its HTTP half (close the listener first so no new requests
// start, THEN flush/drain everything else), plus the PostHog flush that
// was also missing there — see this same fix applied to start-all.ts.
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return; // a second SIGTERM/SIGINT during shutdown must not re-enter this
  shuttingDown = true;
  log.info({ signal }, 'Shutting down — closing HTTP listener, then flushing analytics...');

  await new Promise<void>((resolve) => {
    server.close((err) => {
      if (err) log.warn({ err }, 'Error while closing HTTP server (continuing shutdown regardless)');
      resolve();
    });
  });
  log.info('HTTP listener closed — no new requests accepted');

  try {
    await shutdownPostHog();
    log.info('PostHog client flushed and shut down');
  } catch (err) {
    log.warn({ err }, 'Error while flushing PostHog on shutdown (continuing shutdown regardless)');
  }

  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  log.error({ err }, 'Uncaught exception');
  process.exit(1);
});
