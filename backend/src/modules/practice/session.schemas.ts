import { z } from 'zod';
import { SCENARIO_TYPES, PRESSURE_MODIFIERS, GOAL_TYPES, MAX_STACKED_PRESSURE_MODIFIERS } from './scenario.config';

const scenarioTypeEnum = z.enum(SCENARIO_TYPES.map((s) => s.type) as [string, ...string[]]);
const pressureModifierEnum = z.enum(PRESSURE_MODIFIERS.map((p) => p.type) as [string, ...string[]]);
const goalTypeEnum = z.enum(GOAL_TYPES as unknown as [string, ...string[]]);

export const createSessionSchema = z.object({
  scenario_type: scenarioTypeEnum,
  pressure_modifiers: z.array(pressureModifierEnum).max(MAX_STACKED_PRESSURE_MODIFIERS).optional().default([]),
  difficulty_override: z.enum(['beginner', 'standard', 'advanced', 'expert']).optional(),
  persona_id: z.string().uuid().optional(),
  goal: z
    .object({
      goal_type: goalTypeEnum,
      custom_text: z.string().max(300).optional(),
    })
    .optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(4000),
  attachment_upload_ids: z.array(z.string().uuid()).max(5).optional().default([]),
});

export const renameSessionSchema = z.object({
  title: z.string().min(1).max(200),
});

export const listSessionsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  scenario_type: scenarioTypeEnum.optional(),
  search: z.string().max(200).optional(),
});

export const messagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

export const attachmentsSchema = z.object({
  upload_ids: z.array(z.string().uuid()).min(1).max(5),
});
