import type { SendMessageResponse } from '@/types/api';
import {
  KEEP_GOING_EXCHANGES,
  canSend,
  initialLiveSessionState,
  liveSessionReducer as reduce,
  momentumDirection,
} from '@/utils/liveSession';

const live = { interest: 40, trust: 25, confusion: 5, buying_intent: 50, objection_likelihood: 20, momentum: 3 };
const response = (over: Partial<SendMessageResponse> = {}): SendMessageResponse => ({
  message_ids: ['u', 'b'],
  reply: 'Tell me more.',
  live_state: live,
  natural_ending: null,
  goal_achieved: false,
  ...over,
});
const send = (s = initialLiveSessionState(), id = 'l1') =>
  reduce(s, { type: 'send', localId: id, content: 'hi', idempotencyKey: `key-${id}` });

describe('live session reducer', () => {
  it('shows the user message optimistically and blocks further sends while awaiting', () => {
    const s = send();
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ role: 'user', status: 'sending', idempotencyKey: 'key-l1' });
    expect(s.awaitingReply).toBe(true);
    expect(canSend(s)).toBe(false);
    expect(reduce(s, { type: 'send', localId: 'l2', content: 'again', idempotencyKey: 'k2' })).toBe(s);
  });

  it('appends the buyer reply, updates meters and re-enables the composer', () => {
    const s = reduce(send(), { type: 'reply', localId: 'l1', replyLocalId: 'r1', response: response() });
    expect(s.items.map((i) => [i.role, i.status])).toEqual([['user', 'sent'], ['buyer', 'sent']]);
    expect(s.live).toEqual(live);
    expect(s.hasLiveReading).toBe(true);
    expect(canSend(s)).toBe(true);
  });

  it('marks a failed send, blocks new sends, and retries with the SAME idempotency key', () => {
    let s = reduce(send(), { type: 'fail', localId: 'l1' });
    expect(s.items[0].status).toBe('failed');
    expect(s.awaitingReply).toBe(false);
    expect(canSend(s)).toBe(false);
    s = reduce(s, { type: 'retry', localId: 'l1' });
    expect(s.items[0]).toMatchObject({ status: 'sending', idempotencyKey: 'key-l1' });
    expect(s.items).toHaveLength(1); // never duplicated
  });

  it('goal_achieved ends the session and locks input, ignoring any natural_ending', () => {
    const s = reduce(send(), {
      type: 'reply',
      localId: 'l1',
      replyLocalId: 'r1',
      response: response({ goal_achieved: true, natural_ending: { type: 'x', reason: 'y' } }),
    });
    expect(s.ended).toBe(true);
    expect(s.goalAchieved).toBe(true);
    expect(s.naturalEnding).toBeNull();
    expect(canSend(s)).toBe(false);
    expect(reduce(s, { type: 'send', localId: 'z', content: 'x', idempotencyKey: 'k' })).toBe(s);
  });

  it('surfaces natural_ending, and "keep going" suppresses it for a few exchanges', () => {
    const ending = { type: 'wind_down', reason: 'They are done.' };
    let s = reduce(send(), { type: 'reply', localId: 'l1', replyLocalId: 'r1', response: response({ natural_ending: ending }) });
    expect(s.naturalEnding).toEqual(ending);
    s = reduce(s, { type: 'keepGoing' });
    expect(s.naturalEnding).toBeNull();
    for (let i = 0; i < KEEP_GOING_EXCHANGES; i++) {
      s = send(s, `n${i}`);
      s = reduce(s, { type: 'reply', localId: `n${i}`, replyLocalId: `rn${i}`, response: response({ natural_ending: ending }) });
      expect(s.naturalEnding).toBeNull();
    }
    s = send(s, 'last');
    s = reduce(s, { type: 'reply', localId: 'last', replyLocalId: 'rl', response: response({ natural_ending: ending }) });
    expect(s.naturalEnding).toEqual(ending);
  });

  it('hydrates history without system rows and keeps seed meters until a turn arrives', () => {
    const s = reduce(initialLiveSessionState(), {
      type: 'hydrate',
      live,
      messages: [
        { id: 'a', role: 'user', content: 'hey', sequence_index: 1, created_at: '' },
        { id: 'b', role: 'buyer', content: 'yo', sequence_index: 2, created_at: '' },
        { id: 'c', role: 'system', content: 'Attachment shared.', sequence_index: 3, created_at: '' },
      ],
    });
    expect(s.items.map((i) => i.content)).toEqual(['hey', 'yo']);
    expect(s.hasLiveReading).toBe(false);
  });

  it('markEnded stops everything (e.g. a 409 on send)', () => {
    const s = reduce(send(), { type: 'markEnded' });
    expect(s.ended).toBe(true);
    expect(s.awaitingReply).toBe(false);
    expect(canSend(s)).toBe(false);
  });

  it('derives a three-state momentum direction', () => {
    expect(momentumDirection(5)).toBe('up');
    expect(momentumDirection(1.9)).toBe('flat');
    expect(momentumDirection(-1.9)).toBe('flat');
    expect(momentumDirection(-2)).toBe('down');
  });
});
