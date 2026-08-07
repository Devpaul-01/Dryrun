import { Worker } from 'bullmq';
import app from './app';
import { env } from './config/env';
import { createLogger } from './config/logger';
import { startAllWorkers, shutdownWorkers } from './jobs';

/**
 * Combined API + worker entrypoint — runs the Express server AND all five
 * BullMQ workers inside a single Node process. This is one of THREE
 * supported startup modes, chosen at deploy time by which file you run:
 *
 *   node dist/server.js      — API only    (existing, unchanged)
 *   node dist/jobs/index.js  — worker only (existing, unchanged)
 *   node dist/start-all.js   — API + worker combined (this file, new)
 *
 * None of the three modes import or depend on this file or on each other
 * in a way that changes their standalone behavior — server.ts and
 * jobs/index.ts are untouched at the call-site level; jobs/index.ts's
 * internals were refactored to export startAllWorkers/shutdownWorkers
 * specifically so this file could reuse that exact logic instead of
 * duplicating it, while jobs/index.ts's own `main()` still only runs when
 * that file is executed directly (guarded by `require.main === module`),
 * so standalone worker-mode is unaffected.
 *
 * WHY A SEPARATE FILE AND NOT A FLAG ON server.ts:
 * A flag (`COMBINED_MODE=true node dist/server.js`) would work too, but a
 * dedicated entrypoint file makes the three deployment shapes discoverable
 * from the file tree alone (what would you `node dist/X.js` in a
 * Dockerfile CMD?) rather than requiring someone to know which env var
 * flips the behavior. This mirrors the existing convention of
 * server.ts/jobs/index.ts already being separate entrypoint files rather
 * than one file with a mode flag.
 *
 * WHEN TO USE THIS MODE:
 * Simpler deployments (a single small VM/container, a low-traffic
 * environment, or local/staging) where running two separate processes is
 * unnecessary operational overhead. For production at any real scale,
 * running server.ts and jobs/index.ts as separate deployable units (so
 * each can be scaled and restarted independently — an AI-derivative queue
 * backlog spike shouldn't require redeploying the API, and an API
 * deploy shouldn't interrupt in-flight job processing) is still the
 * better default; this file exists to make the simpler option available,
 * not to replace that guidance.
 *
 * SHUTDOWN ORDERING: on SIGTERM/SIGINT, stop accepting new HTTP
 * connections FIRST (http.Server#close), then close the workers (drains
 * in-flight jobs), then exit. This order matters: closing workers first
 * while the HTTP server keeps accepting requests could mean a request
 * comes in, enqueues a job, and that job is never picked up because its
 * worker already shut down. Closing the HTTP listener first means no new
 * job-enqueuing requests can start once shutdown begins.
 */

const log = createLogger('start-all');

async function main(): Promise<void> {
  const mode = 'combined';
  log.info({ mode }, 'Starting DryRun in combined API + worker mode...');

  const server = app.listen(env.port, () => {
    log.info(`DryRun API listening on port ${env.port} (${env.nodeEnv}) [combined mode]`);
  });

  const workers: Worker[] = await startAllWorkers();
  log.info({ mode }, 'API and all background workers started successfully');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return; // a second SIGTERM/SIGINT during shutdown must not re-enter this
    shuttingDown = true;
    log.info({ signal }, 'Combined process shutting down — closing HTTP listener, then draining jobs...');

    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) log.warn({ err }, 'Error while closing HTTP server (continuing shutdown regardless)');
        resolve();
      });
    });
    log.info('HTTP listener closed — no new requests accepted');

    await shutdownWorkers(workers);
    log.info('All workers drained and closed');

    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  log.error({ err }, 'Uncaught exception');
  process.exit(1);
});

main().catch((err) => {
  log.error({ err }, 'Fatal error starting combined API + worker process');
  process.exit(1);
});
