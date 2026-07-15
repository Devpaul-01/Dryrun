import app from './app';
import { env } from './config/env';
import { createLogger } from './config/logger';

const log = createLogger('server');

app.listen(env.port, () => {
  log.info(`DryRun API listening on port ${env.port} (${env.nodeEnv})`);
});

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  log.error({ err }, 'Uncaught exception');
  process.exit(1);
});
