-- Migration 0003: personas.generation_status
--
-- Backs the fix for FINAL_BACKEND_AUDIT.md finding L2: a persona created
-- via POST /personas/from-source had no structured status field on the
-- personas table itself — the only way to know whether generation had
-- finished (or failed) was the persona:{personaId} realtime channel, or
-- string-matching the "Generating…" placeholder name, which was never a
-- documented API contract. This left the frontend with no REST polling
-- fallback for a missed realtime event (backgrounded app, dropped
-- connection during synthesis).
--
-- DEFAULT VALUE: 'ready', deliberately not 'generating'. This column is
-- being added retroactively to a system that's already running — every
-- existing persona row was either created synchronously with real data
-- already in hand (createManualPersona, demo conversion) or has already
-- finished whatever generation it went through. Defaulting to 'generating'
-- would incorrectly mark every pre-existing, already-complete persona as
-- still in progress. The only code path that explicitly sets 'generating'
-- is the initial insert in persona.service.ts's createPersonaFromSource,
-- immediately before generation begins.

create type persona_generation_status as enum ('generating', 'ready', 'failed');

alter table personas
  add column generation_status persona_generation_status not null default 'ready';
