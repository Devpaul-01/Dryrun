-- =============================================================================
-- DryRun — Complete Database Schema (canonical, generated)
-- =============================================================================
-- GENERATED, not hand-written. This file is the output of
--   pg_dump --schema-only --schema=public
-- run against a real Postgres 16 instance after applying every migration in
-- backend/src/db/migrations/ (0001 through 0015) in order, from empty.
--
-- WHY THIS REPLACED THE PRIOR HAND-WRITTEN SNAPSHOTS: three independently
-- hand-maintained copies of this file previously existed (backend/schema.sql,
-- backend/db/schema.sql, top-level db/schema.sql), all originally written by
-- reverse-engineering the Supabase queries in application code, before any
-- migration files existed. They diverged from each other over time and none
-- were re-verified against the migrations once those were introduced.
-- Generating this file by actually running the real migrations against a
-- real database, instead of hand-transcribing them, is what makes it
-- trustworthy as the canonical reference — and it's how a real bug was
-- found and fixed in the process: practice_sessions.search_vector's
-- generated column previously cast its scenario_type enum to text inline,
-- which Postgres rejects as "not immutable" inside a generated column
-- expression. This had never been caught because the migration had
-- apparently never actually been run end-to-end before. Fixed in
-- 0003_practice_domain.sql with a small immutable wrapper function.
--
-- regen steps (same procedure used to produce this file):
--   1. createdb <throwaway-db>
--   2. Create the standard Supabase roles this project's RLS depends on
--      (authenticated, anon, service_role) and minimal auth.users /
--      realtime.messages / auth.uid() stand-ins — a real Supabase project
--      already has these; a bare local Postgres needs them stubbed. See
--      git history for the exact stub script used, or reconstruct from the
--      auth.*/realtime.* references in backend/src/db/migrations/*.sql.
--   3. psql <throwaway-db> -f backend/src/db/migrations/0001_*.sql
--      ... through 0015_*.sql, in numeric order, stopping immediately
--      on any error — do not continue past a failure.
--   4. pg_dump --schema-only --schema=public --no-owner --no-privileges
--      <throwaway-db> > this file.
--   5. Drop the throwaway database.
--
-- Do not hand-edit this file to add/change schema — change the migrations
-- instead and regenerate. A hand-edit here will silently drift from what
-- the migrations actually produce, which is the exact problem this
-- regeneration was meant to fix.
-- =============================================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: av_scan_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.av_scan_status AS ENUM (
    'pending',
    'clean',
    'flagged'
);


--
-- Name: invite_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invite_status AS ENUM (
    'pending',
    'accepted',
    'expired',
    'revoked'
);


--
-- Name: message_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.message_role AS ENUM (
    'user',
    'buyer',
    'system'
);


--
-- Name: monologue_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.monologue_severity AS ENUM (
    'positive',
    'neutral',
    'negative'
);


--
-- Name: persona_generation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.persona_generation_status AS ENUM (
    'generating',
    'ready',
    'failed'
);


--
-- Name: persona_source_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.persona_source_kind AS ENUM (
    'pasted_text',
    'url',
    'upload'
);


--
-- Name: persona_source_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.persona_source_status AS ENUM (
    'pending',
    'extracted',
    'extraction_failed',
    'synthesized'
);


--
-- Name: persona_source_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.persona_source_type AS ENUM (
    'generated',
    'linkedin_text',
    'company_url',
    'sales_page',
    'job_description',
    'email_thread',
    'document',
    'image',
    'combined'
);


--
-- Name: scenario_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.scenario_type AS ENUM (
    'cold_open',
    'skeptic',
    'price_pushback',
    'bad_timing',
    'long_goodbye',
    'radio_silence',
    'drill'
);


--
-- Name: session_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.session_status AS ENUM (
    'pending',
    'active',
    'completed',
    'abandoned'
);


--
-- Name: subscription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_status AS ENUM (
    'trialing',
    'active',
    'past_due',
    'canceled',
    'incomplete'
);


--
-- Name: upload_purpose; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.upload_purpose AS ENUM (
    'persona_source',
    'session_context'
);


--
-- Name: upload_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.upload_status AS ENUM (
    'uploaded',
    'processing',
    'processed',
    'failed'
);


--
-- Name: validation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.validation_status AS ENUM (
    'accepted',
    'rejected_retried',
    'rejected_fallback'
);


--
-- Name: workspace_member_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.workspace_member_status AS ENUM (
    'active',
    'invited',
    'removed'
);


--
-- Name: workspace_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.workspace_role AS ENUM (
    'owner',
    'admin',
    'member'
);


--
-- Name: allocate_session_sequence_index(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.allocate_session_sequence_index(p_session_id uuid) RETURNS integer
    LANGUAGE sql
    AS $$
  update practice_sessions
  set next_sequence_index = next_sequence_index + 1
  where id = p_session_id
  returning next_sequence_index - 1;
$$;


--
-- Name: reconcile_successful_payment(uuid, uuid, text, numeric, text, text, text, jsonb, public.subscription_status, timestamp with time zone, timestamp with time zone, boolean, text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconcile_successful_payment(p_subscription_id uuid, p_workspace_id uuid, p_provider_tx_ref text, p_amount numeric, p_currency text, p_card_token text, p_provider_tx_id text, p_raw_payload jsonb, p_new_status public.subscription_status, p_new_period_start timestamp with time zone, p_new_period_end timestamp with time zone, p_clear_pending_tx_ref boolean, p_audit_action text, p_audit_actor_user_id uuid, p_audit_metadata jsonb) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
declare
  v_payment_id uuid;
begin
  update subscriptions
  set
    status = p_new_status,
    current_period_start = coalesce(p_new_period_start, current_period_start),
    current_period_end = coalesce(p_new_period_end, current_period_end),
    pending_tx_ref = case when p_clear_pending_tx_ref then null else pending_tx_ref end
  where id = p_subscription_id;

  insert into payment_transactions (
    workspace_id, subscription_id, provider_tx_ref, amount, currency,
    status, card_token, provider_tx_id, raw_payload
  ) values (
    p_workspace_id, p_subscription_id, p_provider_tx_ref, p_amount, p_currency,
    'successful', p_card_token, p_provider_tx_id, p_raw_payload
  )
  returning id into v_payment_id;

  if p_audit_action is not null then
    insert into audit_log (workspace_id, actor_user_id, action, target_type, target_id, metadata)
    values (
      p_workspace_id, p_audit_actor_user_id, p_audit_action, 'subscription',
      p_subscription_id::text, coalesce(p_audit_metadata, '{}'::jsonb)
    );
  end if;

  return v_payment_id;
end;
$$;


--
-- Name: scenario_type_to_text(public.scenario_type); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.scenario_type_to_text(public.scenario_type) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$ select $1::text $_$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_scoring_evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_scoring_evaluations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    message_id uuid,
    raw_response jsonb NOT NULL,
    validation_status public.validation_status NOT NULL,
    accepted_delta jsonb,
    reasoning text NOT NULL,
    prompt_version text NOT NULL,
    flagged_for_review boolean DEFAULT false NOT NULL,
    sampled_for_human_review boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    call_type text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    workspace_id uuid,
    session_id uuid,
    event_name text NOT NULL,
    properties jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    workspace_id uuid,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.badges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid,
    badge_type text NOT NULL,
    badge_label text NOT NULL,
    badge_description text,
    earned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: curriculum_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    weakness_identified text,
    sessions jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: demo_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demo_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    demo_token_hash text NOT NULL,
    ip_hash text NOT NULL,
    fingerprint_hash text NOT NULL,
    persona_snapshot jsonb NOT NULL,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    converted_to_user_id uuid,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_verification_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verification_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    weekly_summary_enabled boolean DEFAULT true NOT NULL,
    async_ready_push_enabled boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    channel text NOT NULL,
    type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    subscription_id uuid,
    provider_tx_ref text NOT NULL,
    amount numeric(10,2),
    currency text,
    status text NOT NULL,
    raw_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    card_token text,
    provider_tx_id text
);


--
-- Name: persona_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.persona_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    source_kind public.persona_source_kind NOT NULL,
    raw_reference text NOT NULL,
    extracted_text text,
    status public.persona_source_status DEFAULT 'pending'::public.persona_source_status NOT NULL,
    contains_flagged_pii boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    scenario_type text
);


--
-- Name: personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    created_by_user_id uuid,
    name text NOT NULL,
    role text NOT NULL,
    company_context text,
    main_pain text DEFAULT ''::text NOT NULL,
    skepticism_about text DEFAULT ''::text NOT NULL,
    communication_style text DEFAULT 'professional and direct'::text,
    hidden_motivations jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_type public.persona_source_type DEFAULT 'generated'::public.persona_source_type NOT NULL,
    reusable boolean DEFAULT true NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, ((((COALESCE(name, ''::text) || ' '::text) || COALESCE(role, ''::text)) || ' '::text) || COALESCE(company_context, ''::text)))) STORED,
    generation_status public.persona_generation_status DEFAULT 'ready'::public.persona_generation_status NOT NULL
);


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    price_amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    billing_interval text DEFAULT 'monthly'::text NOT NULL,
    seat_based boolean DEFAULT false NOT NULL,
    session_limit_per_month integer,
    features jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: playbook_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playbook_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    playbook_id uuid NOT NULL,
    version_number integer NOT NULL,
    opening_message text NOT NULL,
    discovery_questions jsonb DEFAULT '[]'::jsonb NOT NULL,
    objection_responses jsonb DEFAULT '[]'::jsonb NOT NULL,
    closing_cta text NOT NULL,
    key_insight text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: playbooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.playbooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    created_by_user_id uuid,
    title text NOT NULL,
    current_version_id uuid,
    share_token text,
    share_attribution_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: practice_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    product_description text NOT NULL,
    target_audience text NOT NULL,
    tone_preference text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: practice_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    persona_id uuid,
    persona_snapshot jsonb,
    scenario_type public.scenario_type NOT NULL,
    pressure_modifiers jsonb DEFAULT '[]'::jsonb NOT NULL,
    difficulty_level text DEFAULT 'standard'::text NOT NULL,
    title text,
    status public.session_status DEFAULT 'pending'::public.session_status NOT NULL,
    archived_at timestamp with time zone,
    is_demo boolean DEFAULT false NOT NULL,
    retry_of_session_id uuid,
    goal_achieved boolean,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(public.scenario_type_to_text(scenario_type), ''::text)))) STORED,
    next_sequence_index integer DEFAULT 0 NOT NULL
);


--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_context_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_context_summaries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    summary_text text NOT NULL,
    covers_up_to_sequence_index integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_debriefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_debriefs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    strength text NOT NULL,
    improvement text NOT NULL,
    coachable_moment text NOT NULL,
    goal_reference text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    goal_type text NOT NULL,
    custom_text text,
    goal_progress numeric(5,2),
    goal_achieved boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_message_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_message_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    upload_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    role public.message_role NOT NULL,
    content text NOT NULL,
    internal_monologue text,
    monologue_severity public.monologue_severity,
    sequence_index integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(content, ''::text))) STORED
);


--
-- Name: session_retries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_retries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    original_session_id uuid NOT NULL,
    retry_session_id uuid NOT NULL,
    comparison jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_skill_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_skill_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    clarity numeric(5,2) NOT NULL,
    value numeric(5,2) NOT NULL,
    discovery numeric(5,2) NOT NULL,
    objection_handling numeric(5,2) NOT NULL,
    brevity numeric(5,2) NOT NULL,
    cta_strength numeric(5,2) NOT NULL,
    composite_score numeric(5,2) NOT NULL,
    weakest_axis text,
    strongest_axis text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_state_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_state_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    message_id uuid,
    interest numeric(5,2) NOT NULL,
    trust numeric(5,2) NOT NULL,
    confusion numeric(5,2) NOT NULL,
    buying_intent numeric(5,2) DEFAULT 0 NOT NULL,
    objection_likelihood numeric(5,2) DEFAULT 0 NOT NULL,
    momentum numeric(5,2) DEFAULT 0 NOT NULL,
    prompt_version text NOT NULL,
    sequence_index integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    provider text DEFAULT 'flutterwave'::text NOT NULL,
    provider_customer_id text,
    provider_subscription_id text,
    status public.subscription_status DEFAULT 'incomplete'::public.subscription_status NOT NULL,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    trial_ends_at timestamp with time zone,
    canceled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    purpose public.upload_purpose NOT NULL,
    storage_path text NOT NULL,
    original_filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes integer NOT NULL,
    av_scan_status public.av_scan_status DEFAULT 'pending'::public.av_scan_status NOT NULL,
    status public.upload_status DEFAULT 'uploaded'::public.upload_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_skill_trend; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_skill_trend (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    composite_avg numeric(5,2) NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    sessions_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    display_name text,
    current_workspace_id uuid,
    email_verified_at timestamp with time zone,
    onboarding_completed_at timestamp with time zone,
    is_admin boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    provider_event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    processed boolean DEFAULT false NOT NULL,
    signature_verified boolean DEFAULT false NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone
);


--
-- Name: webhook_signature_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_signature_failures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_ip text,
    raw_headers jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email text NOT NULL,
    role public.workspace_role DEFAULT 'member'::public.workspace_role NOT NULL,
    token_hash text NOT NULL,
    status public.invite_status DEFAULT 'pending'::public.invite_status NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    invited_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.workspace_role DEFAULT 'member'::public.workspace_role NOT NULL,
    status public.workspace_member_status DEFAULT 'active'::public.workspace_member_status NOT NULL,
    joined_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    owner_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_scoring_evaluations ai_scoring_evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_scoring_evaluations
    ADD CONSTRAINT ai_scoring_evaluations_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_log ai_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_pkey PRIMARY KEY (id);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: badges badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_pkey PRIMARY KEY (id);


--
-- Name: curriculum_plans curriculum_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plans
    ADD CONSTRAINT curriculum_plans_pkey PRIMARY KEY (id);


--
-- Name: demo_sessions demo_sessions_demo_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_sessions
    ADD CONSTRAINT demo_sessions_demo_token_hash_key UNIQUE (demo_token_hash);


--
-- Name: demo_sessions demo_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_sessions
    ADD CONSTRAINT demo_sessions_pkey PRIMARY KEY (id);


--
-- Name: email_verification_tokens email_verification_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_pkey PRIMARY KEY (id);


--
-- Name: email_verification_tokens email_verification_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: notifications_log notifications_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications_log
    ADD CONSTRAINT notifications_log_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: payment_transactions payment_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_pkey PRIMARY KEY (id);


--
-- Name: payment_transactions payment_transactions_provider_tx_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_provider_tx_ref_key UNIQUE (provider_tx_ref);


--
-- Name: persona_sources persona_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_sources
    ADD CONSTRAINT persona_sources_pkey PRIMARY KEY (id);


--
-- Name: personas personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_pkey PRIMARY KEY (id);


--
-- Name: plans plans_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_key_key UNIQUE (key);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: playbook_versions playbook_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook_versions
    ADD CONSTRAINT playbook_versions_pkey PRIMARY KEY (id);


--
-- Name: playbook_versions playbook_versions_playbook_id_version_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook_versions
    ADD CONSTRAINT playbook_versions_playbook_id_version_number_key UNIQUE (playbook_id, version_number);


--
-- Name: playbooks playbooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbooks
    ADD CONSTRAINT playbooks_pkey PRIMARY KEY (id);


--
-- Name: playbooks playbooks_share_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbooks
    ADD CONSTRAINT playbooks_share_token_key UNIQUE (share_token);


--
-- Name: practice_profiles practice_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_profiles
    ADD CONSTRAINT practice_profiles_pkey PRIMARY KEY (id);


--
-- Name: practice_profiles practice_profiles_user_id_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_profiles
    ADD CONSTRAINT practice_profiles_user_id_workspace_id_key UNIQUE (user_id, workspace_id);


--
-- Name: practice_sessions practice_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_pkey PRIMARY KEY (id);


--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (id);


--
-- Name: push_tokens push_tokens_user_id_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_user_id_token_key UNIQUE (user_id, token);


--
-- Name: session_context_summaries session_context_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_context_summaries
    ADD CONSTRAINT session_context_summaries_pkey PRIMARY KEY (id);


--
-- Name: session_context_summaries session_context_summaries_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_context_summaries
    ADD CONSTRAINT session_context_summaries_session_id_key UNIQUE (session_id);


--
-- Name: session_debriefs session_debriefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_debriefs
    ADD CONSTRAINT session_debriefs_pkey PRIMARY KEY (id);


--
-- Name: session_debriefs session_debriefs_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_debriefs
    ADD CONSTRAINT session_debriefs_session_id_key UNIQUE (session_id);


--
-- Name: session_goals session_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_goals
    ADD CONSTRAINT session_goals_pkey PRIMARY KEY (id);


--
-- Name: session_goals session_goals_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_goals
    ADD CONSTRAINT session_goals_session_id_key UNIQUE (session_id);


--
-- Name: session_message_attachments session_message_attachments_message_id_upload_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_message_attachments
    ADD CONSTRAINT session_message_attachments_message_id_upload_id_key UNIQUE (message_id, upload_id);


--
-- Name: session_message_attachments session_message_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_message_attachments
    ADD CONSTRAINT session_message_attachments_pkey PRIMARY KEY (id);


--
-- Name: session_messages session_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_messages
    ADD CONSTRAINT session_messages_pkey PRIMARY KEY (id);


--
-- Name: session_messages session_messages_session_id_sequence_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_messages
    ADD CONSTRAINT session_messages_session_id_sequence_index_key UNIQUE (session_id, sequence_index);


--
-- Name: session_retries session_retries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_retries
    ADD CONSTRAINT session_retries_pkey PRIMARY KEY (id);


--
-- Name: session_skill_scores session_skill_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_skill_scores
    ADD CONSTRAINT session_skill_scores_pkey PRIMARY KEY (id);


--
-- Name: session_skill_scores session_skill_scores_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_skill_scores
    ADD CONSTRAINT session_skill_scores_session_id_key UNIQUE (session_id);


--
-- Name: session_state_snapshots session_state_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_state_snapshots
    ADD CONSTRAINT session_state_snapshots_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: system_config system_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_pkey PRIMARY KEY (key);


--
-- Name: uploads uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uploads_pkey PRIMARY KEY (id);


--
-- Name: user_skill_trend user_skill_trend_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_skill_trend
    ADD CONSTRAINT user_skill_trend_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_provider_provider_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_provider_provider_event_id_key UNIQUE (provider, provider_event_id);


--
-- Name: webhook_signature_failures webhook_signature_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_signature_failures
    ADD CONSTRAINT webhook_signature_failures_pkey PRIMARY KEY (id);


--
-- Name: workspace_invites workspace_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invites
    ADD CONSTRAINT workspace_invites_pkey PRIMARY KEY (id);


--
-- Name: workspace_invites workspace_invites_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invites
    ADD CONSTRAINT workspace_invites_token_hash_key UNIQUE (token_hash);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_workspace_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: ai_scoring_evaluations_flagged_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_scoring_evaluations_flagged_idx ON public.ai_scoring_evaluations USING btree (flagged_for_review) WHERE (flagged_for_review = true);


--
-- Name: ai_scoring_evaluations_sampled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_scoring_evaluations_sampled_idx ON public.ai_scoring_evaluations USING btree (sampled_for_human_review) WHERE (sampled_for_human_review = true);


--
-- Name: ai_scoring_evaluations_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_scoring_evaluations_session_idx ON public.ai_scoring_evaluations USING btree (session_id);


--
-- Name: ai_usage_log_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_log_workspace_idx ON public.ai_usage_log USING btree (workspace_id, created_at DESC);


--
-- Name: analytics_events_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_name_idx ON public.analytics_events USING btree (event_name, occurred_at DESC);


--
-- Name: analytics_events_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_workspace_idx ON public.analytics_events USING btree (workspace_id, occurred_at DESC);


--
-- Name: audit_log_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_actor_idx ON public.audit_log USING btree (actor_user_id, created_at DESC);


--
-- Name: audit_log_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_workspace_idx ON public.audit_log USING btree (workspace_id, created_at DESC);


--
-- Name: badges_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX badges_user_idx ON public.badges USING btree (user_id);


--
-- Name: demo_sessions_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX demo_sessions_expires_idx ON public.demo_sessions USING btree (expires_at);


--
-- Name: email_verification_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_verification_tokens_user_idx ON public.email_verification_tokens USING btree (user_id);


--
-- Name: idx_payment_transactions_subscription_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_transactions_subscription_created ON public.payment_transactions USING btree (subscription_id, created_at DESC);


--
-- Name: notifications_log_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_log_user_idx ON public.notifications_log USING btree (user_id, created_at DESC, id DESC);


--
-- Name: payment_transactions_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_transactions_workspace_idx ON public.payment_transactions USING btree (workspace_id, created_at DESC);


--
-- Name: persona_sources_persona_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX persona_sources_persona_idx ON public.persona_sources USING btree (persona_id);


--
-- Name: personas_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personas_search_idx ON public.personas USING gin (search_vector);


--
-- Name: personas_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personas_workspace_idx ON public.personas USING btree (workspace_id);


--
-- Name: playbooks_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX playbooks_workspace_idx ON public.playbooks USING btree (workspace_id);


--
-- Name: practice_sessions_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practice_sessions_active_idx ON public.practice_sessions USING btree (archived_at) WHERE (archived_at IS NULL);


--
-- Name: practice_sessions_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practice_sessions_search_idx ON public.practice_sessions USING gin (search_vector);


--
-- Name: practice_sessions_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practice_sessions_user_created_idx ON public.practice_sessions USING btree (user_id, created_at DESC, id DESC);


--
-- Name: practice_sessions_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX practice_sessions_workspace_idx ON public.practice_sessions USING btree (workspace_id);


--
-- Name: session_messages_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_messages_search_idx ON public.session_messages USING gin (search_vector);


--
-- Name: session_messages_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_messages_session_idx ON public.session_messages USING btree (session_id, sequence_index);


--
-- Name: session_state_snapshots_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_state_snapshots_session_idx ON public.session_state_snapshots USING btree (session_id, sequence_index);


--
-- Name: subscriptions_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_workspace_idx ON public.subscriptions USING btree (workspace_id, created_at DESC);


--
-- Name: uploads_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploads_status_idx ON public.uploads USING btree (status);


--
-- Name: uploads_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploads_workspace_idx ON public.uploads USING btree (workspace_id);


--
-- Name: uq_subscriptions_one_active_per_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_subscriptions_one_active_per_workspace ON public.subscriptions USING btree (workspace_id) WHERE (status = 'active'::public.subscription_status);


--
-- Name: user_skill_trend_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_skill_trend_user_idx ON public.user_skill_trend USING btree (user_id, workspace_id, period_start DESC);


--
-- Name: users_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_deleted_at_idx ON public.users USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: webhook_events_processed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhook_events_processed_idx ON public.webhook_events USING btree (processed) WHERE (processed = false);


--
-- Name: webhook_signature_failures_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhook_signature_failures_created_idx ON public.webhook_signature_failures USING btree (created_at DESC);


--
-- Name: workspace_invites_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_invites_workspace_idx ON public.workspace_invites USING btree (workspace_id);


--
-- Name: workspace_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_members_user_idx ON public.workspace_members USING btree (user_id);


--
-- Name: workspace_members_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_members_workspace_idx ON public.workspace_members USING btree (workspace_id);


--
-- Name: personas personas_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER personas_set_updated_at BEFORE UPDATE ON public.personas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: playbooks playbooks_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER playbooks_set_updated_at BEFORE UPDATE ON public.playbooks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: practice_profiles practice_profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER practice_profiles_set_updated_at BEFORE UPDATE ON public.practice_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: practice_sessions practice_sessions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER practice_sessions_set_updated_at BEFORE UPDATE ON public.practice_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users users_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspaces workspaces_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ai_scoring_evaluations ai_scoring_evaluations_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_scoring_evaluations
    ADD CONSTRAINT ai_scoring_evaluations_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.session_messages(id) ON DELETE SET NULL;


--
-- Name: ai_scoring_evaluations ai_scoring_evaluations_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_scoring_evaluations
    ADD CONSTRAINT ai_scoring_evaluations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;


--
-- Name: ai_usage_log ai_usage_log_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: analytics_events analytics_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: audit_log audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: audit_log audit_log_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: badges badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: badges badges_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: curriculum_plans curriculum_plans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plans
    ADD CONSTRAINT curriculum_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: curriculum_plans curriculum_plans_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_plans
    ADD CONSTRAINT curriculum_plans_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: demo_sessions demo_sessions_converted_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_sessions
    ADD CONSTRAINT demo_sessions_converted_to_user_id_fkey FOREIGN KEY (converted_to_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: email_verification_tokens email_verification_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications_log notifications_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications_log
    ADD CONSTRAINT notifications_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payment_transactions payment_transactions_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL;


--
-- Name: payment_transactions payment_transactions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: persona_sources persona_sources_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_sources
    ADD CONSTRAINT persona_sources_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: personas personas_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: personas personas_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: playbook_versions playbook_versions_playbook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbook_versions
    ADD CONSTRAINT playbook_versions_playbook_id_fkey FOREIGN KEY (playbook_id) REFERENCES public.playbooks(id) ON DELETE CASCADE;


--
-- Name: playbooks playbooks_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbooks
    ADD CONSTRAINT playbooks_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: playbooks playbooks_current_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbooks
    ADD CONSTRAINT playbooks_current_version_id_fkey FOREIGN KEY (current_version_id) REFERENCES public.playbook_versions(id) ON DELETE SET NULL;


--
-- Name: playbooks playbooks_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.playbooks
    ADD CONSTRAINT playbooks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: practice_profiles practice_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_profiles
    ADD CONSTRAINT practice_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: practice_profiles practice_profiles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_profiles
    ADD CONSTRAINT practice_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: practice_sessions practice_sessions_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: practice_sessions practice_sessions_retry_of_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_retry_of_session_id_fkey FOREIGN KEY (retry_of_session_id) REFERENCES public.practice_sessions(id) ON DELETE SET NULL;


--
-- Name: practice_sessions practice_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: practice_sessions practice_sessions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_sessions
    ADD CONSTRAINT practice_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: push_tokens push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: session_context_summaries session_context_summaries_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_context_summaries
    ADD CONSTRAINT session_context_summaries_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;


--
-- Name: session_debriefs session_debriefs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_debriefs
    ADD CONSTRAINT session_debriefs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;


--
-- Name: session_goals session_goals_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_goals
    ADD CONSTRAINT session_goals_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;


--
-- Name: session_message_attachments session_message_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_message_attachments
    ADD CONSTRAINT session_message_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.session_messages(id) ON DELETE CASCADE;


--
-- Name: session_message_attachments session_message_attachments_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_message_attachments
    ADD CONSTRAINT session_message_attachments_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.uploads(id);


--
-- Name: session_messages session_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_messages
    ADD CONSTRAINT session_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;


--
-- Name: session_retries session_retries_original_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_retries
    ADD CONSTRAINT session_retries_original_session_id_fkey FOREIGN KEY (original_session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;


--
-- Name: session_retries session_retries_retry_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_retries
    ADD CONSTRAINT session_retries_retry_session_id_fkey FOREIGN KEY (retry_session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;


--
-- Name: session_skill_scores session_skill_scores_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_skill_scores
    ADD CONSTRAINT session_skill_scores_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;


--
-- Name: session_state_snapshots session_state_snapshots_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_state_snapshots
    ADD CONSTRAINT session_state_snapshots_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.session_messages(id) ON DELETE SET NULL;


--
-- Name: session_state_snapshots session_state_snapshots_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_state_snapshots
    ADD CONSTRAINT session_state_snapshots_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.practice_sessions(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id);


--
-- Name: subscriptions subscriptions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: system_config system_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: uploads uploads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uploads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: uploads uploads_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploads
    ADD CONSTRAINT uploads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: user_skill_trend user_skill_trend_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_skill_trend
    ADD CONSTRAINT user_skill_trend_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_skill_trend user_skill_trend_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_skill_trend
    ADD CONSTRAINT user_skill_trend_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: users users_current_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_current_workspace_id_fkey FOREIGN KEY (current_workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: workspace_invites workspace_invites_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invites
    ADD CONSTRAINT workspace_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: workspace_invites workspace_invites_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invites
    ADD CONSTRAINT workspace_invites_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspaces workspaces_owner_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_owner_fk FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: ai_scoring_evaluations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_scoring_evaluations ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_scoring_evaluations ai_scoring_evaluations_owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_scoring_evaluations_owner_only ON public.ai_scoring_evaluations FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.practice_sessions s
  WHERE ((s.id = ai_scoring_evaluations.session_id) AND (s.user_id = auth.uid())))));


--
-- Name: personas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;

--
-- Name: personas personas_workspace_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY personas_workspace_members ON public.personas FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = personas.workspace_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::public.workspace_member_status)))));


--
-- Name: playbooks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;

--
-- Name: playbooks playbooks_workspace_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY playbooks_workspace_members ON public.playbooks FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_members m
  WHERE ((m.workspace_id = playbooks.workspace_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::public.workspace_member_status)))));


--
-- Name: practice_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_sessions practice_sessions_owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY practice_sessions_owner_only ON public.practice_sessions FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: practice_sessions practice_sessions_owner_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY practice_sessions_owner_write ON public.practice_sessions USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: session_debriefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_debriefs ENABLE ROW LEVEL SECURITY;

--
-- Name: session_debriefs session_debriefs_owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY session_debriefs_owner_only ON public.session_debriefs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.practice_sessions s
  WHERE ((s.id = session_debriefs.session_id) AND (s.user_id = auth.uid())))));


--
-- Name: session_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: session_messages session_messages_owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY session_messages_owner_only ON public.session_messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.practice_sessions s
  WHERE ((s.id = session_messages.session_id) AND (s.user_id = auth.uid())))));


--
-- Name: session_state_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_state_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: session_state_snapshots session_state_snapshots_owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY session_state_snapshots_owner_only ON public.session_state_snapshots FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.practice_sessions s
  WHERE ((s.id = session_state_snapshots.session_id) AND (s.user_id = auth.uid())))));


--
-- Name: workspace_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_members workspace_members_self_workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_self_workspace ON public.workspace_members FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_members m2
  WHERE ((m2.workspace_id = workspace_members.workspace_id) AND (m2.user_id = auth.uid()) AND (m2.status = 'active'::public.workspace_member_status)))));


--
-- PostgreSQL database dump complete
--


