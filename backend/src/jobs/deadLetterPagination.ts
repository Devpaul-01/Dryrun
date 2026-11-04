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

/**
 * FIX (backend-takeover audit, Task #15): a bare `{ ms }` watermark per
 * queue silently drops jobs when more than `limit` failures in a queue
 * share the exact same failedAt millisecond at the page boundary.
 * Reproduced directly: 5 jobs at ts=1000 + 3 jobs at ts=2000, limit=3.
 * Page 1 returns the 3 @2000 jobs, watermark becomes 2000. Page 2 widens
 * its tail window until it collects `limit` (3) qualifying jobs — which
 * it finds among the @1000 group — and stops there, the moment it has
 * "enough", even though 2 MORE jobs at that identical timestamp (further
 * from the tail) were left unscanned. Worse, the next watermark is then
 * set to 1000 (same as what's left behind), so "has more" asks for
 * failedAtMs < 1000, which the stranded jobs (also =1000) never satisfy
 * — next_cursor comes back null while 2 real dead-letter jobs are
 * unreachable forever. 2 of 8 jobs vanished from the feed in that
 * reproduction. Fixed by tracking which specific job IDs at the boundary
 * timestamp have already been emitted (`excludeIds`), so the tie-break
 * is exact-set-exclusion rather than relying on the timestamp alone to
 * separate "seen" from "unseen" — mirroring the `(createdAt, id)`
 * compound-keyset pattern lib/cursorPagination.ts already uses for
 * Postgres-backed cursors, adapted here to a set (same-millisecond ties
 * can be more than one job) instead of a single trailing id, since job
 * IDs aren't guaranteed lexicographically sortable the way a DB primary
 * key is.
 */
interface DeadLetterWatermark {
  ms: number;
  excludeIds: string[];
}

interface DeadLetterCursor {
  watermarks: Partial<Record<DeadLetterQueueName, DeadLetterWatermark>>;
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
 * Fetches up to `limit` of a single queue's failed jobs older than
 * `watermark` (or the newest `limit` jobs overall if `watermark` is
 * undefined — i.e. the first page). "Older than" means: failedAtMs
 * strictly less than `watermark.ms`, OR failedAtMs === watermark.ms and
 * the job's id is not in `watermark.excludeIds` (the ids already emitted
 * at that exact boundary millisecond) — see the DeadLetterWatermark
 * comment above for why a bare `ms` comparison alone silently drops
 * same-millisecond siblings. Widens the tail window geometrically if the
 * first pull doesn't surface enough qualifying jobs, stopping once the
 * whole queue has been scanned.
 */
function isOlderThanWatermark(job: FetchedJob, watermark: DeadLetterWatermark): boolean {
  if (job.failedAtMs === null) return true;
  if (job.failedAtMs < watermark.ms) return true;
  if (job.failedAtMs === watermark.ms && !watermark.excludeIds.includes(job.id)) return true;
  return false;
}

async function fetchQueueOlderThan(
  queue: Queue,
  watermark: DeadLetterWatermark | undefined,
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

    const mapped: FetchedJob[] = raw.map((job) => ({
      id: job.id ?? '',
      name: job.name,
      failedReason: job.failedReason ?? '',
      failedAtMs: jobFailedAtMs(job),
      attemptsMade: job.attemptsMade ?? 0,
    }));
    collected = watermark === undefined ? mapped : mapped.filter((job) => isOlderThanWatermark(job, watermark));

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

  const newWatermarks: Partial<Record<DeadLetterQueueName, DeadLetterWatermark>> = { ...priorWatermarks };
  for (const name of QUEUE_NAMES) {
    const thisQueueItems = pageJobs.filter((j) => j.queue === name);
    if (thisQueueItems.length > 0) {
      // Oldest item from this queue that made it into the page sets the
      // new boundary millisecond. excludeIds collects every emitted item
      // (from this page AND any prior page, if the boundary ms is
      // unchanged) at exactly that millisecond, so a same-millisecond
      // sibling that didn't fit on this page is never mistaken for
      // already-seen on the next one.
      const oldestIncluded = thisQueueItems[thisQueueItems.length - 1];
      if (oldestIncluded.failedAtMs !== null) {
        const boundaryMs = oldestIncluded.failedAtMs;
        const priorExcludeIds =
          priorWatermarks[name]?.ms === boundaryMs ? priorWatermarks[name]!.excludeIds : [];
        const idsAtBoundaryThisPage = thisQueueItems.filter((j) => j.failedAtMs === boundaryMs).map((j) => j.id);
        newWatermarks[name] = {
          ms: boundaryMs,
          excludeIds: [...new Set([...priorExcludeIds, ...idsAtBoundaryThisPage])],
        };
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
