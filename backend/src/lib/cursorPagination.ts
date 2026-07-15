import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Shared keyset-pagination helper, used by any list endpoint documented as
 * cursor-paginated in the architecture (sessions, messages, notifications,
 * personas, invoices).
 *
 * The cursor is an opaque, base64-encoded `{ createdAt, id }` pair — callers
 * never see or construct the underlying composite key themselves. This
 * avoids the classic offset-pagination bug (rows shifting between pages as
 * new rows are inserted while a user is paginating) and performs
 * consistently regardless of how large the table grows, since it never
 * scans/skips rows the way `OFFSET n` does.
 */
export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

export interface CursorParams {
  cursor?: string;
  limit?: number;
}

interface DecodedCursor {
  createdAt: string;
  id: string;
}

export function decodeCursor(cursor?: string): DecodedCursor | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

/**
 * Applies a `(created_at, id) < (cursor.createdAt, cursor.id)` keyset filter
 * ordered DESC, and fetches one extra row to determine whether a next page
 * exists without a separate COUNT query.
 */
export async function fetchCursorPage<T extends { id: string; created_at: string }>(
  client: SupabaseClient,
  table: string,
  buildQuery: (q: ReturnType<SupabaseClient['from']>) => ReturnType<SupabaseClient['from']>,
  params: CursorParams
): Promise<CursorPage<T>> {
  const limit = Math.min(params.limit ?? 20, 100);
  const decoded = decodeCursor(params.cursor);

  let query = buildQuery(client.from(table)) as any;
  query = query.order('created_at', { ascending: false }).order('id', { ascending: false });

  if (decoded) {
    // Composite keyset predicate: created_at < X OR (created_at = X AND id < Y)
    query = query.or(
      `created_at.lt.${decoded.createdAt},and(created_at.eq.${decoded.createdAt},id.lt.${decoded.id})`
    );
  }

  const { data, error } = await query.limit(limit + 1);
  if (error) throw error;

  const rows = (data ?? []) as T[];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}
