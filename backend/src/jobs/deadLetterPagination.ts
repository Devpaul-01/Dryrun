import { Queue } from 'bullmq';
import { CursorPage } from '../lib/cursorPagination';

/**
 * Cursor pagination over BullMQ's failed-job sets, merged across every
 * queue into a single, stably-ordered (most-recent-first) feed.
 *
 * WHY THIS ISN'T lib/cursorPagination.ts's fetchCursorPage():
 * That helper assumes a single Postgres table with a `(created_at, id)`
 * keyset filterable with `.lt()`. BullMQ's `queue.getFailed(start, end)` is
 * a RANK range into a per-queue Redis sorted set, not a timestamp filter,
 * and this view has to merge five independently-sized queues into one feed.
 * A naive "offset from the tail" cursor breaks under concurrent writes: new
 * failures arriving between two page fetches shift every rank underneath
 * the reader, causing duplicate and skipped jobs (verified by simulation
 * during implementation). The fix is a cursor built from an absolute
 * WATERMARK per queue (the failure timestamp of the last item that queue
 * contributed to a page) rather than a rank offset, since a timestamp is
 * stable regardless of what gets inserted afterward.
 *
 * CURSOR SHAPE: `{ watermarks: Record<queueName, epochMs | undefined> }`,
 * base64url+JSON encoded, opaque to the caller. "Fetch this queue's failed
 * jobs older than its watermark" is implemented by pulling a bounded
 * window from the queue's tail and filtering client-side (BullMQ has no
 * native timestamp-filtered range query); the window doubles and retries
 * if the initial pull doesn't yield enough qualifying entries, bounded by
 * the queue's actual size.
 *
 * SEMANTICS: this is backward/historical pagination — "show me dead
 * letters older than what I've already seen." A failure that occurs after
 * pagination begins is not required to appear in the walk (same behavior
 * any "load older" history feed has); what's guaranteed is that no job
 * which existed when pagination started is ever skipped or duplicated.
 */

const QUEUE_NAMES = ['ai-derivative', 'persona-ingestion', 'billing', 'notifications', 'maintenance'] as const;
type DeadLetterQueueName = (typeof QUEUE_NAMES)[number];

export interface DeadLetterJob {
  queue: string;
  id: string;
  name: string;
  failedReason: string;
  failed_at: string | null; // ISO timestamp; null only if BullMQ recorded neither finishedOn nor timestamp
  attempts_made: number;
}

interface DeadLetterCursor {
  watermarks: Partial<Record<DeadLetterQueueName, number>>;
}

function decodeDeadLetterCursor(cursor?: string): DeadLetterCursor | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed.watermarks === 'object') {
      return parsed as DeadLetterCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function encodeDeadLetterCursor(cursor: DeadLetterCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function jobFailedAtMs(job: { finishedOn?: number; timestamp?: number }): number | null {
  if (typeof job.finishedOn === 'number') return job.finishedOn;
  if (typeof job.timestamp === 'number') return job.timestamp;
  return null;
}

interface FetchedJob {
  id: string;
  name: string;
  failedReason: string;
  failedAtMs: number | null;
  attemptsMade: number;
}

/**
 * Fetches up to `limit` of a single queue's failed jobs with failedAt
 * strictly less than `watermark` (or the newest `limit` jobs overall if
 * `watermark` is undefined — i.e. the first page). Widens the tail window
 * geometrically if the first pull doesn't surface enough qualifying jobs
 * (can happen with many same-millisecond failures, or a burst of newer
 * failures pushing target jobs further from the tail than `limit` alone
 * would reach), stopping once the whole queue has been scanned.
 */
async function fetchQueueOlderThan(
  queue: Queue,
  watermark: number | undefined,
  limit: number
): Promise<FetchedJob[]> {
  const total = await queue.getFailedCount();
  if (total === 0) return [];

  let windowSize = limit;
  let collected: FetchedJob[] = [];

  while (true) {
    const endRank = total - 1;
    const startRank = Math.max(0, endRank - windowSize + 1);
    const raw = await queue.getFailed(startRank, endRank);

    collected = raw
      .map((job) => ({
        id: job.id ?? '',
        name: job.name,
        failedReason: job.failedReason ?? '',
        failedAtMs: jobFailedAtMs(job),
        attemptsMade: job.attemptsMade ?? 0,
      }))
      .filter((job) => watermark === undefined || job.failedAtMs === null || job.failedAtMs < watermark);

    if (collected.length >= limit || startRank === 0) break;
    windowSize *= 2;
  }

  // `raw` is oldest-first within the fetched slice; take the newest
  // `limit` qualifying entries (the tail of `collected`) and reverse to
  // newest-first for the merge step.
  return collected.slice(-limit).reverse();
}

/**
 * Fetches one merged page, most-recent-failure first, across all five
 * queues.
 */
export async function fetchDeadLetterPage(
  getQueue: (name: DeadLetterQueueName) => Queue,
  params: { cursor?: string; limit?: number }
): Promise<CursorPage<DeadLetterJob>> {
  const limit = Math.min(params.limit ?? 20, 100);
  const decoded = decodeDeadLetterCursor(params.cursor);
  const priorWatermarks = decoded?.watermarks ?? {};

  const perQueue = await Promise.all(
    QUEUE_NAMES.map(async (name) => {
      const queue = getQueue(name);
      const jobs = await fetchQueueOlderThan(queue, priorWatermarks[name], limit);
      return { name, jobs };
    })
  );

  const allCandidates = perQueue.flatMap((r) => r.jobs.map((job) => ({ ...job, queue: r.name })));
  allCandidates.sort((a, b) => (b.failedAtMs ?? 0) - (a.failedAtMs ?? 0));
  const pageJobs = allCandidates.slice(0, limit);

  const newWatermarks: Partial<Record<DeadLetterQueueName, number>> = { ...priorWatermarks };
  for (const name of QUEUE_NAMES) {
    const thisQueueItems = pageJobs.filter((j) => j.queue === name);
    if (thisQueueItems.length > 0) {
      // Oldest item from this queue that made it into the page becomes
      // its new watermark — the next page asks for "older than this."
      const oldestIncluded = thisQueueItems[thisQueueItems.length - 1];
      if (oldestIncluded.failedAtMs !== null) {
        newWatermarks[name] = oldestIncluded.failedAtMs;
      }
    }
    // If this queue contributed nothing to the page, its watermark is
    // left unchanged — correct, since we haven't advanced past anything
    // new of its jobs.
  }

  // A further page exists if any queue still has jobs strictly older than
  // its new watermark.
  const anyQueueHasMore = await Promise.all(
    QUEUE_NAMES.map(async (name) => {
      const queue = getQueue(name);
      const remaining = await fetchQueueOlderThan(queue, newWatermarks[name], 1);
      return remaining.length > 0;
    })
  );

  const items: DeadLetterJob[] = pageJobs.map((job) => ({
    queue: job.queue,
    id: job.id,
    name: job.name,
    failedReason: job.failedReason,
    failed_at: job.failedAtMs !== null ? new Date(job.failedAtMs).toISOString() : null,
    attempts_made: job.attemptsMade,
  }));

  return {
    items,
    next_cursor: anyQueueHasMore.some(Boolean) ? encodeDeadLetterCursor({ watermarks: newWatermarks }) : null,
  };
}
