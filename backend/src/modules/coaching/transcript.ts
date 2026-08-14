import { supabaseAdmin } from '../../config/supabase';

/**
 * The "Founder: ... / Prospect: ..." transcript format, previously
 * duplicated byte-for-byte in four places: debrief.service.ts's
 * buildTranscript, scoring.service.ts's buildTranscript, and TWICE inside
 * playbook.service.ts's bestTranscriptFor (once for the direct-session
 * path, once for the fallback-to-best-scoring-session path). All four
 * call sites now call this single function instead.
 *
 * Deliberately local to modules/coaching/ rather than promoted to a
 * top-level lib/ helper — "Founder"/"Prospect" is a coaching-domain
 * convention specific to this product's sales-practice framing, not a
 * generic transcript formatter.
 *
 * Note: this is distinct from debrief.service.ts's
 * renderSessionExportAsText(), which reformats an ALREADY-FETCHED
 * SessionExportPayload for a downloadable export — that function doesn't
 * query session_messages itself, so it isn't a duplicate of this one and
 * isn't folded in here.
 */
export async function buildSessionTranscript(sessionId: string): Promise<string> {
  const { data: messages } = await supabaseAdmin()
    .from('session_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .neq('role', 'system')
    .order('sequence_index', { ascending: true });

  return (messages ?? []).map((m) => `${m.role === 'user' ? 'Founder' : 'Prospect'}: ${m.content}`).join('\n');
}
