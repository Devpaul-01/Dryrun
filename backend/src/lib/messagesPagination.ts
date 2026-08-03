import { SupabaseClient } from '@supabase/supabase-js';
import { CursorPage } from './cursorPagination';

/**
 * Cursor pagination for session_messages, keyed on `sequence_index` rather
 * than `(created_at, id)`.
 *
 * WHY NOT lib/cursorPagination.ts's fetchCursorPage(): that helper's
 * keyset is `(created_at, id)`, which is the right choice for tables
 * without a per-parent sequence column. session_messages already has a
 * better key for this exact purpose: `sequence_index` is a gap-free,
 * per-session integer assigned in session.service.ts's nextSequenceIndex()
 * and is the ordering every other part of the codebase already treats as
 * canonical (the bounded history window sent to the AI, state snapshots,
 * transcript builders for debrief/scoring/playbook generation). Reusing
 * that same key for pagination means the ordering guarantee here is
 * identical to the ordering guarantee everywhere else messages are read —
 * one integer comparison, no composite tie-break needed since
 * sequence_index is already unique per session.
 *
 * DIRECTION: newest-first (matching how session.service.ts's own
 * HISTORY_WINDOW_SIZE fetch already works — most-recent N by
 * `sequence_index DESC`), since that's the natural "open a conversation,
 * see the latest turns, scroll up for older" chat pattern. The cursor
 * therefore encodes "give me messages with sequence_index strictly less
 * than this," and the caller is expected to reverse `items` client-side
 * (or here, server-side) if chronological top-to-bottom rendering is
 * wanted for a given page — see session.routes.ts's usage.
 */

export interface MessagesCursorParams {
  cursor?: string;
  limit?: number;
}

interface DecodedMessagesCursor {
  sequenceIndex: number;
}

function decodeMessagesCursor(cursor?: string): DecodedMessagesCursor | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (typeof parsed.sequenceIndex === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}

function encodeMessagesCursor(sequenceIndex: number): string {
  return Buffer.from(JSON.stringify({ sequenceIndex }), 'utf8').toString('base64url');
}

export interface SessionMessageRow {
  id: string;
  role: string;
  content: string;
  sequence_index: number;
  created_at: string;
  internal_monologue?: string | null;
  monologue_severity?: string | null;
}

/**
 * Fetches one page of a session's messages, most-recent first internally
 * (for efficient keyset filtering), returned oldest-first in `items` since
 * that's the natural reading order for a chat transcript page. `next_cursor`
 * is set whenever older messages remain beyond this page.
 */
export async function fetchMessagesPage(
  client: SupabaseClient,
  sessionId: string,
  params: MessagesCursorParams,
  selectColumns: string
): Promise<CursorPage<SessionMessageRow>> {
  const limit = Math.min(params.limit ?? 50, 200);
  const decoded = decodeMessagesCursor(params.cursor);

  let query = client
    .from('session_messages')
    .select(selectColumns)
    .eq('session_id', sessionId)
    .neq('role', 'system')
    .order('sequence_index', { ascending: false });

  if (decoded) {
    query = query.lt('sequence_index', decoded.sequenceIndex);
  }

  const { data, error } = await query.limit(limit + 1);
  if (error) throw error;

  const rows = (data ?? []) as unknown as SessionMessageRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const oldestInPage = page[page.length - 1];

  return {
    // Reverse to oldest-first for natural chat-transcript reading order
    // within this page.
    items: [...page].reverse(),
    next_cursor: hasMore && oldestInPage ? encodeMessagesCursor(oldestInPage.sequence_index) : null,
  };
}
