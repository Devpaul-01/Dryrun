import { z } from 'zod';
import { SCENARIO_TYPES } from './scenario.config';

// FIX (BACKEND_API_RECOMMENDATIONS.md finding R1): reuses the same source
// of truth session.schemas.ts's createSessionSchema already validates
// scenario_type against, instead of accepting any free string. Previously
// a client could write a persona whose scenario_type doesn't match any
// value the rest of the system (prompt builders, the scenario catalog,
// a frontend scenario-picker) actually recognizes, with no 400.
const scenarioTypeEnum = z.enum(SCENARIO_TYPES.map((s) => s.type) as [string, ...string[]]);

export const createPersonaSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  company_context: z.string().max(500).optional(),
  main_pain: z.string().max(1000),
  skepticism_about: z.string().max(500),
  communication_style: z.string().max(200).optional(),
});

export const createPersonaFromSourceSchema = z.object({
  scenario_type: scenarioTypeEnum,
  source_kind: z.enum(['pasted_text', 'url', 'upload']),
  // Bounded per architecture §19.6 — prevents prompt-stuffing via an
  // oversized pasted persona source.
  pasted_text: z.string().max(20000).optional(),
  url: z.string().url().optional(),
  upload_id: z.string().uuid().optional(),
});

export const updatePersonaSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.string().min(1).max(120).optional(),
  main_pain: z.string().max(1000).optional(),
  skepticism_about: z.string().max(500).optional(),
  communication_style: z.string().max(200).optional(),
});
