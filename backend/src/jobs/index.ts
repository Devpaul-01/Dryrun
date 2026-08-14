import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { createLogger } from '../config/logger';
import { registerSchedules, dispatchWeeklySummaries } from './scheduler';
import { QueueName } from './queues';

import { generateDebriefHandler } from './workers/generateDebrief.worker';
import { scoreSessionSkillsHandler } from './workers/scoreSessionSkills.worker';
import { recomputeSkillTrendHandler } from './workers/recomputeSkillTrend.worker';
import { recomputeCurriculumHandler } from './workers/recomputeCurriculum.worker';
import { scoringConsistencyCheckHandler } from './workers/scoringConsistencyCheck.worker';
import { summarizeConversationHandler } from './workers/summarizeConversation.worker';
import { avScanUploadHandler } from './workers/avScanUpload.worker';
import { extractPersonaSourceHandler } from './workers/extractPersonaSource.worker';
import { synthesizePersonaHandler } from './workers/synthesizePersona.worker';
import { processWebhookEventHandler } from './workers/processWebhookEvent.worker';
import { attemptRenewalChargeHandler } from './workers/attemptRenewalCharge.worker';
import { sendPaymentFailedEmailHandler } from './workers/sendPaymentFailedEmail.worker';
import { sendWeeklySummaryHandler } from './workers/sendWeeklySummary.worker';
import { purgeExpiredDemoSessionsHandler } from './workers/purgeExpiredDemoSessions.worker';
import { purgeSoftDeletedAccountsHandler } from './workers/purgeSoftDeletedAccounts.worker';
import { purgeOrphanedUploadsHandler } from './workers/purgeOrphanedUploads.worker';
import { archiveOldSnapshotsHandler } from './workers/archiveOldSnapshots.worker';
import { sampleAiScoringEvaluationsHandler } from './workers/sampleAiScoringEvaluations.worker';
import { exportUserDataHandler } from './workers/exportUserData.worker';

const log = createLogger('jobs-index');

type Handler = (job: Job) => Promise<void>;

const HANDLERS: Record<string, Handler> = {
  generate_debrief: generateDebriefHandler,
  score_session_skills: scoreSessionSkillsHandler,
  recompute_skill_trend: recomputeSkillTrendHandler,
  recompute_curriculum: recomputeCurriculumHandler,
  run_async_scoring_consistency_check: scoringConsistencyCheckHandler,
  summarize_conversation: summarizeConversationHandler,
  av_scan_upload: avScanUploadHandler,
  extract_persona_source: extractPersonaSourceHandler,
  synthesize_persona: synthesizePersonaHandler,
  process_webhook_event: processWebhookEventHandler,
  attempt_renewal_charge: attemptRenewalChargeHandler,
  send_payment_failed_email: sendPaymentFailedEmailHandler,
  send_weekly_summary: sendWeeklySummaryHandler,
  purge_expired_demo_sessions: purgeExpiredDemoSessionsHandler,
  purge_soft_deleted_accounts: purgeSoftDeletedAccountsHandler,
  purge_orphaned_uploads: purgeOrphanedUploadsHandler,
  archive_old_session_state_snapshots: archiveOldSnapshotsHandler,
  sample_ai_scoring_evaluations_for_review: sampleAiScoringEvaluationsHandler,
  export_user_data: exportUserDataHandler,
  dispatch_weekly_summaries: async () => dispatchWeeklySummaries(),
};

const QUEUE_CONCURRENCY: Record<QueueName, number> = {
  'ai-derivative': 8,
  'persona-ingestion': 6,
  billing: 3, // low concurrency, high reliability priority — never starved by ai-derivative load
  notifications: 15, // cheap, high volume
  maintenance: 2,
};

const QUEUE_NAMES: QueueName[] = ['ai-derivative', 'persona-ingestion', 'billing', 'notifications', 'maintenance'];

function startWorker(queueName: QueueName): Worker {
  const worker = new Worker(
    queueName,
    async (job: Job) => {
      const handler = HANDLERS[job.name];
      if (!handler) {
        log.error({ queueName, jobName: job.name }, 'No handler registered for job');
        return;
      }
      const start = Date.now();
      await handler(job);
      log.info({ queueName, jobName: job.name, jobId: job.id, durationMs: Date.now() - start }, 'Job completed');
    },
    { connection: redisConnection() as any, concurrency: QUEUE_CONCURRENCY[queueName] }
  );

  worker.on('failed', (job, err) => {
    log.error({ queueName, jobName: job?.name, jobId: job?.id, err }, 'Job failed');
  });

  return worker;
}

/**
 * Starts all five queue workers and registers schedules. Exported (rather
 * than only run via this file's own `main()` below) so a combined
 * entrypoint (start-all.ts) can start workers in-process alongside the API
 * server without duplicating this logic or fighting over process-level
 * signal handlers — see start-all.ts's own comment for why that matters.
 *
 * `registerSchedules` is called here unconditionally — safe to call from
 * any number of concurrently-booting processes (standalone worker
 * replicas or combined-mode replicas via start-all.ts) since
 * scheduler.ts now uses BullMQ's Job Scheduler API (upsertJobScheduler),
 * which is atomic and idempotent by job-scheduler-id at the Redis level.
 * This used to require a manual distributed lock around a non-atomic
 * read-delete-add sequence against BullMQ's now-deprecated repeatable-
 * jobs API — see scheduler.ts's own header comment for the full history.
 */
export async function startAllWorkers(): Promise<Worker[]> {
  log.info('Starting DryRun background workers...');
  const workers = QUEUE_NAMES.map(startWorker);
  await registerSchedules();
  log.info({ queues: QUEUE_NAMES }, 'All workers started and schedules registered');
  return workers;
}

/** Closes every worker, draining in-flight jobs before resolving. */
export async function shutdownWorkers(workers: Worker[]): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
}

async function main(): Promise<void> {
  const workers = await startAllWorkers();

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down workers — draining in-flight jobs...');
    await shutdownWorkers(workers);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Only self-invoke in standalone worker-mode. When start-all.ts imports
// startAllWorkers/shutdownWorkers directly, this module's own main() must
// NOT also run — otherwise the combined process would start every worker
// twice and register two competing sets of SIGTERM/SIGINT handlers.
// require.main === module is the standard Node idiom for "was this file
// executed directly, or only imported by something else" — true when
// launched as `node dist/jobs/index.js`, false when `import`ed.
if (require.main === module) {
  main().catch((err) => {
    log.error({ err }, 'Fatal error starting workers');
    process.exit(1);
  });
}
