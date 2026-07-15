import { z } from 'zod';

export const createPersonaSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  company_context: z.string().max(500).optional(),
  main_pain: z.string().max(1000),
  skepticism_about: z.string().max(500),
  communication_style: z.string().max(200).optional(),
});

export const createPersonaFromSourceSchema = z.object({
  scenario_type: z.string(),
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
