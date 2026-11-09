import { HttpResponse, http } from 'msw';

import { env } from '@/config/env';
import type { ScenarioCatalog } from '@/types/api';

const API = env.apiRoot;

export const mockScenarioCatalog: ScenarioCatalog = {
  scenario_types: [
    { type: 'cold_open', label: 'Cold open', description: 'Start from zero context.' },
    { type: 'skeptic', label: 'Skeptic', description: 'A buyer who doubts everything you say.' },
    {
      type: 'price_pushback',
      label: 'Price pushback',
      description: 'They like it, but the price is a wall.',
    },
    { type: 'bad_timing', label: 'Bad timing', description: "It's a good fit, wrong moment." },
    {
      type: 'long_goodbye',
      label: 'Long goodbye',
      description: 'A buyer who won’t say no, or yes.',
    },
    {
      type: 'radio_silence',
      label: 'Radio silence',
      description: 'Re-engage someone who’s gone quiet.',
    },
    { type: 'drill', label: 'Drill', description: 'Rapid-fire reps on one specific skill.' },
  ],
  pressure_modifiers: [
    { type: 'decision_maker_watching', label: 'Decision-maker watching' },
    { type: 'competitor_mentioned', label: 'Competitor mentioned' },
    { type: 'rushed_impatient', label: 'Rushed / impatient' },
    { type: 'compliance_concern', label: 'Compliance concern' },
  ],
  communication_style_presets: ['Direct', 'Analytical', 'Relationship-driven', 'Skeptical'],
  conversation_channel_presets: ['Cold call', 'Discovery call', 'Follow-up email', 'DM'],
};

export const catalogHandlers = [
  http.get(`${API}/scenarios`, () => HttpResponse.json(mockScenarioCatalog)),
];
