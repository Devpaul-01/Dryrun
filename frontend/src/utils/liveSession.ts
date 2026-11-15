import type { LiveTurnState, SendMessageResponse, SessionMessage } from '@/types/api';

/** Turns after "Keep going" during which the wrap-up banner stays suppressed (matches the backend's informational extra_exchanges_allowed). */
export const KEEP_GOING_EXCHANGES = 3;

export type ChatItemStatus = 'sent' | 'sending' | 'failed';

export interface ChatItem {
  localId: string;
  role: 'user' | 'buyer';
  content: string;
  status: ChatItemStatus;
  /** Reused verbatim on retry so the server never records the turn twice. */
  idempotencyKey?: string;
}

export interface NaturalEnding {
  type: string;
  reason: string;
}

export interface LiveSessionState {
  items: ChatItem[];
  live: LiveTurnState;
  /** True from send until the reply (or failure) arrives: drives the typing indicator. */
  awaitingReply: boolean;
  naturalEnding: NaturalEnding | null;
  /** Remaining exchanges for which a natural_ending signal is ignored after "Keep going". */
  suppressEndingFor: number;
  /** The backend ended the session (goal achieved, or a 409 on send): no further input is allowed. */
  ended: boolean;
  goalAchieved: boolean;
  /** True once any turn in this mount returned live_state; false means meters still show seed values. */
  hasLiveReading: boolean;
}

export type LiveSessionAction =
  | { type: 'hydrate'; messages: SessionMessage[]; live: LiveTurnState }
  | { type: 'send'; localId: string; content: string; idempotencyKey: string }
  | { type: 'retry'; localId: string }
  | { type: 'reply'; localId: string; replyLocalId: string; response: SendMessageResponse }
  | { type: 'fail'; localId: string }
  | { type: 'keepGoing' }
  | { type: 'markEnded' };

export const SEED_LIVE_STATE: LiveTurnState = {
  interest: 30,
  trust: 15,
  confusion: 0,
  buying_intent: 0,
  objection_likelihood: 0,
  momentum: 0,
};

export function initialLiveSessionState(live: LiveTurnState = SEED_LIVE_STATE): LiveSessionState {
  return {
    items: [],
    live,
    awaitingReply: false,
    naturalEnding: null,
    suppressEndingFor: 0,
    ended: false,
    goalAchieved: false,
    hasLiveReading: false,
  };
}

/** Whether the composer may submit right now. Single place the "never send into a dead session" rule lives. */
export function canSend(state: LiveSessionState): boolean {
  if (state.ended || state.awaitingReply) return false;
  return !state.items.some((i) => i.status === 'failed' || i.status === 'sending');
}

export function liveSessionReducer(state: LiveSessionState, action: LiveSessionAction): LiveSessionState {
  switch (action.type) {
    case 'hydrate':
      return {
        ...state,
        live: action.live,
        items: action.messages
          .filter((m): m is SessionMessage & { role: 'user' | 'buyer' } => m.role === 'user' || m.role === 'buyer')
          .map((m) => ({ localId: m.id, role: m.role, content: m.content, status: 'sent' as const })),
      };

    case 'send':
      if (!canSend(state)) return state;
      return {
        ...state,
        awaitingReply: true,
        items: [
          ...state.items,
          {
            localId: action.localId,
            role: 'user',
            content: action.content,
            status: 'sending',
            idempotencyKey: action.idempotencyKey,
          },
        ],
      };

    case 'retry':
      if (state.ended || state.awaitingReply) return state;
      return {
        ...state,
        awaitingReply: true,
        items: state.items.map((i) => (i.localId === action.localId && i.status === 'failed' ? { ...i, status: 'sending' } : i)),
      };

    case 'reply': {
      const { response } = action;
      const suppressed = state.suppressEndingFor > 0;
      return {
        ...state,
        awaitingReply: false,
        live: response.live_state,
        hasLiveReading: true,
        goalAchieved: state.goalAchieved || response.goal_achieved,
        // goal_achieved means the backend already ended the session.
        ended: state.ended || response.goal_achieved,
        suppressEndingFor: suppressed ? state.suppressEndingFor - 1 : 0,
        naturalEnding: suppressed || response.goal_achieved ? null : (response.natural_ending ?? state.naturalEnding),
        items: [
          ...state.items.map((i) => (i.localId === action.localId ? { ...i, status: 'sent' as const } : i)),
          { localId: action.replyLocalId, role: 'buyer', content: response.reply, status: 'sent' },
        ],
      };
    }

    case 'fail':
      return {
        ...state,
        awaitingReply: false,
        items: state.items.map((i) => (i.localId === action.localId ? { ...i, status: 'failed' } : i)),
      };

    case 'keepGoing':
      return { ...state, naturalEnding: null, suppressEndingFor: KEEP_GOING_EXCHANGES };

    case 'markEnded':
      return { ...state, ended: true, awaitingReply: false, naturalEnding: null };
  }
}

export type MomentumDirection = 'up' | 'flat' | 'down';

/** Three-state trend for the momentum chip; |momentum| < 2 reads as flat (architecture doc §8). */
export function momentumDirection(momentum: number): MomentumDirection {
  if (momentum >= 2) return 'up';
  if (momentum <= -2) return 'down';
  return 'flat';
}
