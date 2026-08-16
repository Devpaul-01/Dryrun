-- Migration 0001: persona_sources.scenario_type
--
-- Backs the fix for FINAL_BACKEND_AUDIT.md findings C1/C1a: the persona
-- ingestion pipeline (persona.service.ts -> extractPersonaSource.worker.ts
-- -> avScanUpload.worker.ts -> synthesizePersona.worker.ts) previously had
-- no durable place to record which scenario type a persona-from-source
-- request was for, once that request left the initiating route handler.
-- scenario_type was threaded through BullMQ job payloads on two of three
-- ingestion paths (pasted_text, url) but was never included on the third
-- (upload), which meant every persona generated from an uploaded document
-- silently received `scenario_type: undefined` in its synthesis prompt.
--
-- This column belongs on persona_sources rather than personas because it
-- describes a property of the INGESTION REQUEST, not of the resulting
-- persona (a persona is, at least conceptually, re-groundable from a new
-- source later without necessarily changing its identity). Every worker in
-- the ingestion chain already has personaSourceId on its job payload, so
-- this column becomes the single durable source of truth every stage can
-- read from directly, instead of relying on scenario_type surviving intact
-- across three separate job-payload hops.
--
-- Nullable and backfill-free by design: rows created before this migration
-- have no scenario_type and are not retroactively repaired — they are, by
-- definition, already-completed or already-abandoned ingestion attempts,
-- not something a future worker run will re-read.

alter table persona_sources
  add column scenario_type text;
