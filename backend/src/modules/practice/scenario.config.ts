/**
 * Static catalog exposed via GET /scenarios. Scenario types, pressure
 * modifiers (max 2 stackable, enforced at the service layer — a product
 * rule, not a data-integrity rule, per the architecture doc), and the
 * communication-style/channel presets added as cheap realism levers.
 */
export const SCENARIO_TYPES = [
  { type: 'cold_open', label: 'Cold Open', description: 'First contact, breaking the ice.' },
  { type: 'skeptic', label: 'The Skeptic', description: 'Buyer pushes back and challenges your claims.' },
  { type: 'price_pushback', label: 'Price Pushback', description: 'Buyer is interested but says it costs too much.' },
  { type: 'bad_timing', label: 'Bad Timing', description: 'Buyer is receptive but says "not right now."' },
  { type: 'long_goodbye', label: 'The Long Goodbye', description: 'Practice ending gracefully / getting a real no.' },
  { type: 'radio_silence', label: 'Radio Silence', description: 'The buyer may not respond unless your message earns it.' },
  { type: 'drill', label: 'Micro-Drill', description: 'A single-exchange drill on one specific skill.' },
] as const;

export type ScenarioType = (typeof SCENARIO_TYPES)[number]['type'];

export const PRESSURE_MODIFIERS = [
  { type: 'decision_maker_watching', label: 'Decision-maker watching' },
  { type: 'competitor_mentioned', label: 'Competitor already in play' },
  { type: 'rushed_impatient', label: 'Rushed / impatient buyer' },
  { type: 'compliance_concern', label: 'Compliance / approval concerns' },
] as const;

export type PressureModifierType = (typeof PRESSURE_MODIFIERS)[number]['type'];

export const MAX_STACKED_PRESSURE_MODIFIERS = 2;

export const COMMUNICATION_STYLE_PRESETS = ['terse_formal', 'chatty_informal', 'highly_technical'] as const;
export const CONVERSATION_CHANNEL_PRESETS = ['email_style', 'chat_sms_style'] as const;

export const GOAL_TYPES = ['book_meeting', 'yes_no_budget', 'uncover_objection', 'get_reply', 'custom'] as const;
