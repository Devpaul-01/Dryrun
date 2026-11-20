import { create } from 'zustand';

import type { DemoCategory, DemoMessage, DemoPersona } from '@/api/demo';

/** In-memory state of the anonymous demo conversation (the token is the only credential and is never persisted). */
interface DemoState {
  token: string | null;
  category: DemoCategory | null;
  persona: DemoPersona | null;
  messages: DemoMessage[];
  /** null until the first reply reports it. */
  remaining: number | null;
  begin: (token: string, persona: DemoPersona, category: DemoCategory) => void;
  addUser: (content: string) => void;
  addBuyer: (content: string, remaining: number) => void;
  dropLastUser: () => void;
  reset: () => void;
}

export const DEMO_MESSAGE_CAP = 8;

export const useDemoStore = create<DemoState>((set) => ({
  token: null,
  category: null,
  persona: null,
  messages: [],
  remaining: null,
  begin: (token, persona, category) => set({ token, persona, category, messages: [], remaining: DEMO_MESSAGE_CAP }),
  addUser: (content) => set((s) => ({ messages: [...s.messages, { role: 'user', content }] })),
  addBuyer: (content, remaining) => set((s) => ({ messages: [...s.messages, { role: 'buyer', content }], remaining })),
  dropLastUser: () => set((s) => ({ messages: s.messages.slice(0, -1) })),
  reset: () => set({ token: null, category: null, persona: null, messages: [], remaining: null }),
}));
