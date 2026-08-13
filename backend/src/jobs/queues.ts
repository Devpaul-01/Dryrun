import { Queue, JobsOptions } from 'bullmq';
import { redisConnection } from '../config/redis';
import { createLogger } from '../config/logger';

const log = createLogger('queues');

/**
 * Five logically distinct queues, each with its own retry/priority
 * characteristics (architecture doc §11.1) — never one generic queue for
 * everything, because billing correctness matters more than throughput,
 * while notifications are cheap and high-volume, and derivative AI jobs
 * sit somewhere in between.
 */
export type QueueName = 'ai-derivative' | 'persona-ingestion' | 'billing' | 'notifications' | 'maintenance';

const QUEUE_NAMES: QueueName[] = ['ai-derivative', 'persona-ingestion', 'billing', 'notifications', 'maintenance'];

const _queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  if (!_queues.has(name)) {
    // Cast: BullMQ bundles its own ioredis typings internally, which can
    // drift from the top-level ioredis package's types even when the
    // actual runtime versions are compatible. This is a well-known,
    // harmless friction point between the two libraries — the connection
    // object works correctly at runtime.
    _queues.set(name, new Queue(name, { connection: redisConnection() as any }));
  }
  return _queues.get(name)!;
}

const DEFAULT_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  'ai-derivative': { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { count: 500 }, removeOnFail: { count: 1000 } },
  'persona-ingestion': { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { count: 500 }, removeOnFail: { count: 1000 } },
  // Billing follows its own dunning schedule at the call-site (attemptRenewalCharge.worker.ts)
  // rather than generic exponential backoff — attempts here bounds webhook-processing retries specifically.
  billing: { attempts: 5, backoff: { type: 'exponential', delay: 10000 }, removeOnComplete: { count: 2000 }, removeOnFail: { count: 5000 } },
  notifications: { attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 500 } },
  maintenance: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { count: 100 }, removeOnFail: { count: 200 } },
};

/**
 * The single enqueue entry point used everywhere in the codebase.
 * `idempotencyKey`, when supplied, becomes the BullMQ job ID — BullMQ
 * treats a duplicate job ID as a no-op, which is how job-level idempotency
 * (architecture doc §11.2's "keyed on X" column) is actually implemented.
 */
export async function enqueue(
  queueName: QueueName,
  jobName: string,
  data: Record<string, unknown>,
  options: JobsOptions & { idempotencyKey?: string; priority?: number } = {}
): Promise<string> {
  const { idempotencyKey, ...rest } = options;
  const queue = getQueue(queueName);
  const job = await queue.add(jobName, data, {
    ...DEFAULT_JOB_OPTIONS[queueName],
    ...rest,
    ...(idempotencyKey ? { jobId: idempotencyKey } : {}),
  });
  log.debug({ queueName, jobName, jobId: job.id }, 'Job enqueued');
  return job.id ?? '';
}

export async function getAllQueueDepths(): Promise<Record<string, { waiting: number; active: number; failed: number; delayed: number }>> {
  const result: Record<string, any> = {};
  for (const name of QUEUE_NAMES) {
    const queue = getQueue(name);
    const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
    result[name] = counts;
  }
  return result;
}

/**
 * NOTE: the unpaginated getDeadLetterJobs() that used to live here has been
 * replaced by jobs/deadLetterPagination.ts's fetchDeadLetterPage(), which
 * merges all five queues' failed-job sets into one cursor-paginated feed.
 * getQueue() (above) is exported specifically so that module can reach
 * each queue without duplicating the Queue-instance-caching logic here.
 */

export async function retryJob(queueName: string, jobId: string): Promise<void> {
  const queue = getQueue(queueName as QueueName);
  const job = await queue.getJob(jobId);
  if (job) await job.retry();
}
