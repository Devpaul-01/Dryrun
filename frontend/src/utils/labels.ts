import type { ScenarioType, SkillAxisKey } from '@/types/api';

/** Static scenario catalog labels (matches the backend catalog); unknown values fall back to a humanized key. */
const SCENARIO_LABELS: Record<ScenarioType, string> = {
  cold_open: 'Cold Open',
  skeptic: 'The Skeptic',
  price_pushback: 'Price Pushback',
  bad_timing: 'Bad Timing',
  long_goodbye: 'The Long Goodbye',
  radio_silence: 'Radio Silence',
  drill: 'Micro-Drill',
};

const AXIS_LABELS: Record<SkillAxisKey, string> = {
  clarity: 'Clarity',
  value: 'Value',
  discovery: 'Discovery',
  objection_handling: 'Objection handling',
  brevity: 'Brevity',
  cta_strength: 'Call to action',
};

function humanize(key: string): string {
  const spaced = key.replace(/_/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : 'Unknown';
}

export const scenarioLabel = (type: string): string =>
  (SCENARIO_LABELS as Record<string, string>)[type] ?? humanize(type);

export const axisLabel = (axis: string): string =>
  (AXIS_LABELS as Record<string, string>)[axis] ?? humanize(axis);

const SOURCE_LABELS: Record<string, string> = {
  generated: 'Written by you',
  linkedin_text: 'LinkedIn text',
  company_url: 'Website',
  sales_page: 'Sales page',
  job_description: 'Job description',
  email_thread: 'Email thread',
  document: 'Document',
  image: 'Image',
  combined: 'Pasted text',
};

export const personaSourceLabel = (type: string): string => SOURCE_LABELS[type] ?? humanize(type);
