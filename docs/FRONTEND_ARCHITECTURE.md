# DryRun — Mobile Frontend Architecture

**Scope:** The Expo / React Native / TypeScript client that consumes the existing DryRun backend (`backend/`, Express + Supabase + BullMQ, documented in `ARCHITECTURE.md` and `PRODUCT_OVERVIEW.md`). This document is architecture only — no implementation. Every API detail below was taken directly from the backend source (routes, Zod schemas, services, `db/schema.sql`) on branch `main` at commit `41fc29f4`. Where the backend is ambiguous, incomplete, or has a gap, it's called out explicitly in **§11 — Gaps & Open Questions** rather than papered over.

---

## Table of Contents

1. [Product & Backend Summary (grounding)](#1-product--backend-summary)
2. [API Surface Map](#2-api-surface-map)
3. [Data Models (TypeScript)](#3-data-models-typescript)
4. [API Integration Strategy](#4-api-integration-strategy)
5. [Application Architecture](#5-application-architecture)
6. [Navigation Structure](#6-navigation-structure)
7. [Screen-by-Screen Specification](#7-screen-by-screen-specification)
8. [The Simulation Experience — Deep Design](#8-the-simulation-experience--deep-design)
9. [Design System](#9-design-system)
10. [Project Structure](#10-project-structure)
11. [Gaps & Open Questions (backend)](#11-gaps--open-questions-backend)
12. [Implementation Milestones](#12-implementation-milestones)

---

## 1. Product & Backend Summary

DryRun is a sales-practice simulator. A founder describes what they sell once ("Instant Setup"), then practices real-time text conversations against an AI buyer persona built from that description, a scenario type, and optional pressure modifiers. Every turn runs through one structured, schema-validated AI call that returns the buyer's reply, a private monologue, deltas to interest/trust/confusion, buying-intent/objection scores, and goal-achievement judgment. Sessions end into an async debrief + six-axis skill score; retries reuse the same persona for an exact before/after comparison; good sessions can be turned into shareable playbooks.

Backend facts that shape the frontend directly:

- **No streaming.** `POST /sessions/:id/messages` is a plain synchronous `await`-style POST — the whole AI call happens server-side before one JSON response comes back. There is no SSE/WebSocket for the live-turn exchange. Any "typing…" indicator is a pure client-side affordance with no real partial data behind it — design it as a *determinate-feeling but indeterminate-duration* wait, not a token stream.
- **Realtime is used only for persona generation status**, via Supabase Realtime, channel convention `persona:{personaId}`, with a documented REST-polling fallback (`GET /personas/:id`) because the realtime payload/event name isn't fully specified in the backend (see §11).
- **Everything authenticated requires a resolved workspace.** Every personal/practice/billing call needs `Authorization: Bearer <token>` + (implicitly or via `x-workspace-id` header) a workspace context. A user can belong to multiple workspaces; the client must track and send the active one.
- **All list endpoints are cursor-paginated** — `{ items: T[], next_cursor: string | null }`, with `cursor`/`limit` (1–100) query params. The cursor is opaque; never parse it.
- **Message history is append-only.** There is no edit, no delete, no regenerate on any session message. The frontend must not build UI affordances for any of those.
- **Entitlements are a 402, not a 403.** Feature gates (`canStartSession`, `canGeneratePlaybook`, `canGeneratePersonaFromDocument`) throw `402` with `{ error: <GATE_REASON>, message, details: { plan, limit } }` — this is the paywall signal and must be special-cased in the API layer, not treated as a generic error.

---

## 2. API Surface Map

Base URL: `{API_BASE}/api/v1` (health check is the one exception, at bare `/health`). Auth header: `Authorization: Bearer <supabase_access_token>` on everything except the routes marked **public** below. Workspace header: `x-workspace-id: <uuid>` — required for a multi-workspace user; falls back to `users.current_workspace_id` if omitted.

Legend: 🔓 public · 🔑 authenticated · 🏢 authenticated + workspace-scoped · 👑 role-gated (owner/admin as noted) · 🛡 admin-only

### 2.1 Auth (`/auth`)

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/auth/signup` | 🔓 | `{email, password(8-72), displayName?}` → `201 {success, user_id, message}` |
| POST | `/auth/login` | 🔓 | `{email, password}` → `{access_token, refresh_token, expires_at}` |
| POST | `/auth/refresh` | 🔓 | `{refresh_token}` → new token pair |
| POST | `/auth/logout` | 🔑 | `{pushToken?}` → revokes local session only |
| POST | `/auth/logout-all` | 🔑 | revokes every session + all push tokens |
| POST | `/auth/forgot-password` | 🔓 | `{email}` → always `{success:true}` (anti-enumeration) |
| POST | `/auth/reset-password` | 🔓 | `{token, newPassword(8-72)}` |
| POST | `/auth/verify-email` | 🔓 | `{token}` |
| POST | `/auth/resend-verification` | 🔑 | no body |
| POST | `/auth/recover-account` | 🔓 | `{email, password}` — undoes a soft-delete within the 14-day grace window; deliberately bypasses the normal `authenticate` 403 |
| POST | `/auth/google/callback` | 🔓 | `{access_token}` (Supabase token obtained client-side via `expo-auth-session`) → finalizes profile/workspace bootstrap |
| GET | `/auth/me` | 🔑 | → `{user}` |

`GET /auth/google/start` is a **web-only** redirect flow — do not call it from the app; use `expo-auth-session` + Supabase directly, then hit `/auth/google/callback` with the resulting token.

### 2.2 User Account (`/user`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/user/me` | 🔑 | (same as `/auth/me`) |
| PATCH | `/user/me` | 🔑 | `{display_name?(1-120)}` → `{user}` |
| DELETE | `/user/me` | 🔑 | soft-delete, 14-day recovery window; `409` if sole owner of a multi-member workspace |
| GET | `/user/notification-preferences` | 🔑 | → `{preferences: {weekly_summary_enabled, async_ready_push_enabled}}` |
| PATCH | `/user/notification-preferences` | 🔑 | partial update of the two booleans above |
| GET | `/user/export` | 🔑 (stricter rate limit) | `202 {job_id, message}` — async; result arrives via notification, not in this response |

### 2.3 Workspace (`/workspaces`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/workspaces` | 🔑 | → `{workspaces: [...]}` — powers the workspace switcher |
| GET | `/workspaces/current` | 🏢 | → `{workspace}` |
| POST | `/workspaces/current/switch` | 🔑 | `{workspace_id}` — persists as new default |
| PATCH | `/workspaces/current` | 👑 owner/admin | `{name?(1-200)}` |
| GET | `/workspaces/current/members` | 🏢 cursor | `{cursor?, limit?}` → `{items, next_cursor}` |
| GET | `/workspaces/current/team-progress` | 👑 owner/admin | → `{progress}` — aggregate only, structurally cannot include a member's transcript |
| POST | `/workspaces/current/invites` | 👑 owner/admin | `{email, role: 'admin'|'member'}` → `201 {invite}` |
| POST | `/workspaces/invites/:token/accept` | 🔑 | no workspace header needed |
| DELETE | `/workspaces/current/members/:id` | 👑 owner/admin | |
| POST | `/workspaces/current/leave` | 🔑 | self-service |
| PATCH | `/workspaces/current/members/:id/role` | 👑 owner only | `{role}` |
| POST | `/workspaces/current/transfer-ownership` | 👑 owner only | `{newOwnerUserId}` |

### 2.4 Onboarding & Dashboard

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/onboarding/instant-setup` | 🏢 | `{product_description(1-1000), target_audience(1-1000), tone_preference?(≤300)}` |
| GET | `/onboarding/status` | 🏢 | → `{onboarding_completed: boolean}` — **per-workspace**, not global |
| GET | `/dashboard` | 🏢 (cached 5 min) | → `{last_session, skill_trend, suggested_curriculum, team_progress}` (`team_progress` only for owner/admin) |

### 2.5 Scenarios & Personas

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/scenarios` | 🏢 (static, cache client-side) | → `{scenario_types[7], pressure_modifiers[4], communication_style_presets[3], conversation_channel_presets[2]}` |
| GET | `/personas` | 🏢 cursor | → `{items, next_cursor}` |
| POST | `/personas` | 🏢 | manual persona, synchronous, no AI → `201 {persona}` (`generation_status: 'ready'` immediately) |
| POST | `/personas/from-source` | 🏢 (rate-limited, entitlement `canGeneratePersonaFromDocument`) | `{scenario_type, source_kind: 'pasted_text'|'url'|'upload', pasted_text?, url?, upload_id?}` → `202 {persona, message}`, `generation_status: 'generating'` |
| GET | `/personas/:id` | 🏢 | → `{persona}` — **the polling fallback for generation status** |
| PATCH | `/personas/:id` | 🏢 | partial update; server force-sets `generation_status: 'ready'` on any successful edit |
| DELETE | `/personas/:id` | 🏢 | soft delete |

**⚠ Client responsibility:** the backend does **not** enforce which of `pasted_text`/`url`/`upload_id` is required for a given `source_kind` — send exactly the one matching field or the request may silently no-op server-side logic. See §11.

### 2.6 Sessions — the core loop (`/sessions`)

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/sessions` | 🏢 (entitlement `canStartSession`) | `{scenario_type, pressure_modifiers?(≤2), difficulty_override?, persona_id?, goal?}` → `201 {session}`. **Slow if `persona_id` omitted** — synchronous persona generation happens inline. |
| GET | `/sessions` | 🏢 cursor | `{cursor?, limit?, archived?, scenario_type?, search?}` → `{items, next_cursor}` |
| GET | `/sessions/:id` | 🏢 | `403` if owned by another user (not `404`) |
| PATCH | `/sessions/:id` | 🏢 | `{title(1-200)}` → rename |
| POST | `/sessions/:id/archive` \| `/unarchive` | 🏢 | → `{success}` |
| DELETE | `/sessions/:id` | 🏢 | `409` if `status === 'completed'` — only pending/active sessions are deletable |
| **POST** | **`/sessions/:id/messages`** | 🏢 (rate-limited, `Idempotency-Key` header supported) | **the live-turn endpoint** — see §2.6.1 |
| GET | `/sessions/:id/messages` | 🏢 cursor (sequence_index-keyed, never cached) | → `{items: [{id, role, content, sequence_index, created_at}], next_cursor}` |
| POST | `/sessions/:id/end` | 🏢 | → `{already_completed: boolean}`; enqueues debrief + scoring jobs (async) |
| POST | `/sessions/:id/continue` | 🏢 | dismisses a `natural_ending` signal → `{extra_exchanges_allowed: 3}` (informational only, not server-enforced) |
| GET | `/sessions/:id/debrief` | 🏢 | → `{debrief}` or `{debrief: null}` while pending |
| GET | `/sessions/:id/replay` | 🏢 | → `{messages (incl. internal_monologue + monologue_severity), heatmap}` — `400` if not completed |
| GET | `/sessions/:id/export` | 🏢 | `?format=json\|text` → full `SessionExportPayload` (json) or plain text with download headers (text — **not meaningfully usable on Expo**, prefer json + `expo-file-system` if a local save is wanted) |
| POST | `/sessions/:id/retry` | 🏢 (entitlement `canStartSession`) | `400` unless original `status === 'completed'` → `201 {session}` — same persona + scenario, **no** goal/difficulty carried forward |
| GET | `/sessions/:id/comparison` | 🏢 | → `{comparison}` or a not-ready signal — see §2.6.2 |
| POST | `/sessions/:id/goal` | 🏢 | `{goal_type, custom_text?}` upsert |
| POST | `/sessions/:id/attachments` | 🏢 | `{upload_ids[1-5]}` → `409` unless session `active` |
| GET | `/sessions/:id/attachments` | 🏢 | → `{attachments: [...]}` |

#### 2.6.1 `POST /sessions/:id/messages` — exact contract

Request:
```ts
{ content: string;                 // 1–4000 chars
  attachment_upload_ids?: string[]; // uuids, max 5
}
```
Header: `Idempotency-Key: <client-generated uuid>` — **always send one**; mobile networks retry, and this is the only endpoint in the API that supports safe retry.

Response:
```ts
{
  message_ids: [string, string];   // [user_message_id, buyer_message_id]
  reply: string;                   // buyer's in-character reply
  live_state: {
    interest: number;              // 0-100, cumulative, clamped server-side
    trust: number;                 // 0-100, cumulative, clamped server-side
    confusion: number;             // 0-100, cumulative, clamped server-side
    buying_intent: number;         // 0-100, per-turn absolute (NOT cumulative)
    objection_likelihood: number;  // 0-100, per-turn absolute (NOT cumulative)
    momentum: number;              // rolling mean of last-3-turn interest deltas; unbounded, can be negative
  };
  natural_ending: { type: string; reason: string } | null; // soft signal only — session stays active
  goal_achieved: boolean;          // true ONLY on the exact turn it first flips — sticky, one-shot
}
```

Critical semantics:
- `goal_achieved: true` means the backend has **already called `endSession()` internally** — session `status` is now `completed`. Treat this response as "conversation is over," transition straight to the end-of-session flow; do not let the user send another message.
- `natural_ending` is advisory only. Surface a dismissible "wrap up?" prompt; `POST /:id/continue` clears it for ~3 more exchanges (UI-level budget, not server-enforced).
- `internal_monologue` / `monologue_severity` are **not** in this response and **not** in `GET /sessions/:id/messages` either — they only appear via `GET /sessions/:id/replay`, which requires the session to be `completed`. **Design implication:** the live monologue reveal the product description promises ("revealed after the session") can only be built from the replay endpoint post-completion — there is no live/mid-session monologue feed. See §11.

#### 2.6.2 `GET /sessions/:id/comparison` — exact contract

```ts
{
  original_scores: SixAxisScores;   // see §3.6
  retry_scores: SixAxisScores;
  deltas: Record<AxisKey | 'composite_score', number>; // retry - original
  original_goal_achieved: boolean | null;
  retry_goal_achieved: boolean | null;
  summary: string;                  // AI-authored, ≤500 chars
}
```
If either session isn't scored yet, treat an empty/null comparison as "check back soon" — poll, don't error.

### 2.7 Coaching (`/playbooks`, `/badges`, `/skill-trend`, `/curriculum`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/playbooks` | 🏢 cursor | `{items: [{id,title,created_at,share_token}], next_cursor}` |
| POST | `/playbooks` | 🏢 (rate-limited, entitlement `canGeneratePlaybook`, `Idempotency-Key`) | `{persona_id?, session_id?, title?(≤200)}` → `201 {playbook}` |
| GET | `/playbooks/:id` | 🏢 | → `{playbook}` with current version joined |
| GET | `/playbooks/:id/versions` | 🏢 | → `{versions: [...]}` newest first |
| POST | `/playbooks/:id/regenerate` | 🏢 (rate-limited, entitlement) | → `{playbook}` |
| POST | `/playbooks/:id/share` | 🏢 | `{attribution_enabled?}` → `{share_token}` |
| DELETE | `/playbooks/:id/share` | 🏢 | revokes |
| GET | `/public/playbooks/:token` | 🔓 | → `{playbook}` — no app access needed; build a public (non-authed) share-view screen/deep-link target |
| GET | `/badges` | 🏢 | → `{badges: [...]}` — no pagination |
| GET | `/skill-trend` | 🏢 (cached 2 min) | → `{trend: [...]}` last 12 periods |
| GET | `/skill-trend/goals` | 🏢 | → `{goal_achievement_rates: [{goal_type, rate, total}]}` |
| GET | `/curriculum/current` | 🏢 | → `{curriculum}` |
| POST | `/curriculum/dismiss` | 🏢 | `{curriculum_id}` |

### 2.8 Billing (`/billing`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/billing/plans` | 🏢 | → `{plans: [...]}` |
| GET | `/billing/subscription` | 👑 owner/admin | → `{subscription}` or `null`, `plans(*)` joined |
| POST | `/billing/checkout` | 👑 owner/admin | `{plan_key}` → `201 {...checkout}` (provider URL/ref) |
| GET | `/billing/checkout/:ref/status` | 👑 owner/admin | poll after returning from checkout |
| POST | `/billing/cancel` | 👑 owner only | → `{effective_at}` — cancels at period end |
| POST | `/billing/change-plan` | 👑 owner/admin | `{plan_key}` |
| POST | `/billing/reactivate` | 👑 owner/admin | `400` if no pending cancellation |
| GET | `/billing/invoices` | 👑 owner/admin, cursor | `{items, next_cursor}` |
| GET | `/billing/usage` | 🏢 | → `{usage}` |

**Feature-gate (402) shape**, thrown by `canStartSession`, `canGeneratePlaybook`, `canGeneratePersonaFromDocument` (and reserved `canUseVoiceMode`):
```ts
// HTTP 402
{ error: 'SESSION_LIMIT_REACHED' | 'PLAYBOOK_LIMIT_REACHED' | 'PERSONA_FROM_DOCUMENT_NOT_INCLUDED' | 'VOICE_MODE_NOT_INCLUDED',
  message: 'This action requires a plan upgrade.',
  details: { plan: string; limit?: number } }
```
The API client must intercept `402` globally and route to a shared upgrade-prompt flow keyed by `error`, not treat it as a generic failure toast.

### 2.9 Files (`/uploads`)

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/uploads/signed-url` | 🏢 (rate-limited) | `{purpose: 'persona_source'|'session_context', filename(1-255), mime_type, size_bytes(≤10MB)}` → `201 {upload_id, signed_url, storage_path}` |
| *(client → Supabase Storage directly)* | — | — | upload bytes straight to `signed_url`, bypassing the API |
| POST | `/uploads/:id/complete` | 🏢 | confirms upload, triggers AV scan (+ extraction pipeline if `purpose=persona_source`) |
| GET | `/uploads/:id` | 🏢 | → `{upload}` |
| DELETE | `/uploads/:id` | 🏢 | |

Allowed MIME types: PDF, DOCX, plain text, PNG, JPEG. Multiple files = multiple sequential `/signed-url` calls (no bulk endpoint).

### 2.10 Notifications (`/notifications`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/notifications` | 🏢 cursor | `{items, next_cursor}` |
| POST | `/notifications/:id/read` | 🏢 | |
| POST | `/notifications/mark-all-read` | 🏢 | |
| POST | `/notifications/push-token` | 🏢 | `{token}` — **register the Expo push token here** (pass the raw Expo push token string) |

### 2.11 Demo (`/demo`) — fully public, pre-signup funnel

| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/demo/start` | `{fingerprint(1-200), category?: 'saas'|'services'|'physical_product'}` | `201 {token, persona, scenario_type}` |
| POST | `/demo/:token/messages` | `{content(1-2000)}` | `{reply, messages_remaining}`; `403` after 8 user messages |
| POST | `/demo/:token/end` | — | `{success}` |
| GET | `/demo/:token/replay` | — | `{messages, persona}` |
| POST | `/demo/:token/convert` | `{email, password(≥8)}` | `201 {userId, workspaceId, sessionId, message}` |

Demo sessions have no live `live_state`/monologue data exposed in this response shape (unlike the real live-turn endpoint) — plan the demo UI around `reply` + a remaining-messages counter only, not a full interest/trust meter, unless backend confirms otherwise (see §11).

### 2.12 Analytics & Health

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/analytics/events` | 🏢 | `{event_name(1-100), properties?, session_id?}` → `202 {success}` |
| GET | `/health` | 🔓 | liveness |
| GET | `/health/ready` | 🔓 | readiness (DB+Redis) |

---

## 3. Data Models (TypeScript)

These mirror the backend's actual Postgres schema (`backend/db/schema.sql`) and API response shapes exactly — field names are not reformatted to camelCase, because the backend returns them as-is (snake_case) and remapping invites drift. Put these in `src/types/api.ts` (entities) and `src/types/requests.ts` (request bodies), generated/maintained by hand against this document, not inferred.

```ts
// ---------- Enums (exact backend values) ----------

export type ScenarioType =
  | 'cold_open' | 'skeptic' | 'price_pushback' | 'bad_timing'
  | 'long_goodbye' | 'radio_silence' | 'drill';

export type PressureModifier =
  | 'decision_maker_watching' | 'competitor_mentioned'
  | 'rushed_impatient' | 'compliance_concern';

export type DifficultyLevel = 'beginner' | 'standard' | 'advanced' | 'expert';

export type GoalType =
  | 'book_meeting' | 'yes_no_budget' | 'uncover_objection' | 'get_reply' | 'custom';

export type SessionStatus = 'pending' | 'active' | 'completed'; // + orthogonal archived_at

export type MessageRole = 'user' | 'buyer' | 'system';

export type MonologueSeverity = 'positive' | 'neutral' | 'negative';

export type PersonaGenerationStatus = 'generating' | 'ready' | 'failed';
export type PersonaSourceType =
  | 'generated' | 'linkedin_text' | 'company_url' | 'sales_page'
  | 'job_description' | 'email_thread' | 'document' | 'image' | 'combined';
export type PersonaSourceKind = 'pasted_text' | 'url' | 'upload';

export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type WorkspaceMemberStatus = 'active' | 'invited' | 'removed';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
export type UploadPurpose = 'persona_source' | 'session_context';
export type UploadStatus = 'uploaded' | 'processing' | 'processed' | 'failed';

export type SkillAxisKey =
  | 'clarity' | 'value' | 'discovery' | 'objection_handling' | 'brevity' | 'cta_strength';

// ---------- Core entities ----------

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  current_workspace_id: string | null;
  email_verified_at: string | null;
  onboarding_completed_at: string | null; // legacy, workspace-level flag is authoritative
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  status: WorkspaceMemberStatus;
  joined_at: string | null;
  created_at: string;
  users: Pick<User, 'email' | 'display_name'>;
}

export interface Persona {
  id: string;
  workspace_id: string;
  created_by_user_id: string | null;
  name: string;              // 'Generating…' while generation_status === 'generating'
  role: string;
  company_context: string | null;
  main_pain: string;
  skepticism_about: string;
  communication_style: string;
  hidden_motivations: string[];
  source_type: PersonaSourceType;
  reusable: boolean;
  generation_status: PersonaGenerationStatus;
  created_at: string;
  updated_at: string;
}

// Frozen copy on a session — same shape as Persona plus seed scores.
export interface PersonaSnapshot extends Omit<Persona, 'id' | 'workspace_id' | 'created_by_user_id'> {
  interest_score?: number; // seeds live_state.interest at session start (default 30)
  trust_score?: number;    // seeds live_state.trust at session start (default 15)
}

export interface PracticeSession {
  id: string;
  user_id: string;
  workspace_id: string;
  persona_id: string | null;
  persona_snapshot: PersonaSnapshot | null;
  scenario_type: ScenarioType;
  pressure_modifiers: PressureModifier[];
  difficulty_level: DifficultyLevel | string;
  title: string | null;
  status: SessionStatus;
  archived_at: string | null;
  is_demo: boolean;
  retry_of_session_id: string | null;
  goal_achieved: boolean | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionMessage {
  id: string;
  role: MessageRole;
  content: string;
  sequence_index: number;
  created_at: string;
  // Only present via GET /sessions/:id/replay (completed sessions only):
  internal_monologue?: string;
  monologue_severity?: MonologueSeverity;
}

export interface SessionGoal {
  goal_type: GoalType;
  custom_text: string | null;
  goal_achieved: boolean | null;
}

export interface LiveTurnState {
  interest: number;             // 0-100 cumulative
  trust: number;                // 0-100 cumulative
  confusion: number;            // 0-100 cumulative
  buying_intent: number;        // 0-100 per-turn
  objection_likelihood: number; // 0-100 per-turn
  momentum: number;              // unbounded rolling mean
}

export interface SendMessageResponse {
  message_ids: [string, string];
  reply: string;
  live_state: LiveTurnState;
  natural_ending: { type: string; reason: string } | null;
  goal_achieved: boolean;
}

export interface SessionDebrief {
  session_id: string;
  strength: string;
  improvement: string;
  coachable_moment: string;
  goal_reference: string | null;
  generated_at: string;
}

export interface SixAxisScores {
  clarity: number;
  value: number;
  discovery: number;
  objection_handling: number;
  brevity: number;
  cta_strength: number;
  composite_score: number;
}

export interface SessionSkillScores extends SixAxisScores {
  session_id: string;
  weakest_axis: SkillAxisKey;
  strongest_axis: SkillAxisKey;
}

export interface SessionComparison {
  original_scores: SixAxisScores;
  retry_scores: SixAxisScores;
  deltas: Record<SkillAxisKey | 'composite_score', number>;
  original_goal_achieved: boolean | null;
  retry_goal_achieved: boolean | null;
  summary: string;
}

export interface StateSnapshot {
  id: string;
  message_id: string | null;
  interest: number;
  trust: number;
  confusion: number;
  buying_intent: number;
  objection_likelihood: number;
  momentum: number;
  sequence_index: number;
  created_at: string;
}

export interface SkillTrendPoint {
  composite_avg: number;
  period_start: string;
  period_end: string;
  sessions_count: number;
}

export interface CurriculumPlan {
  id: string;
  weakness_identified: SkillAxisKey | null;
  sessions: Array<{ scenario_type: ScenarioType; difficulty_level?: DifficultyLevel; reason?: string }>;
  status: 'active' | string;
  expires_at: string | null;
}

export interface Badge {
  id: string;
  badge_type: string;
  badge_label: string;
  badge_description: string | null;
  earned_at: string;
}

export interface PlaybookVersion {
  version_number: number;
  opening_message: string;
  discovery_questions: string[];
  objection_responses: Array<{ objection: string; response: string }> | string[];
  closing_cta: string;
  key_insight: string;
  created_at: string;
}

export interface Playbook {
  id: string;
  title: string;
  share_token: string | null;
  share_attribution_enabled: boolean;
  current_version: PlaybookVersion;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  key: string;
  name: string;
  price_amount: number;
  currency: string;
  billing_interval: string;
  session_limit_per_month: number | null;
  features: Record<string, unknown>;
}

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  plans: Plan;
}

export interface FeatureGateError {
  error: 'SESSION_LIMIT_REACHED' | 'PLAYBOOK_LIMIT_REACHED'
       | 'PERSONA_FROM_DOCUMENT_NOT_INCLUDED' | 'VOICE_MODE_NOT_INCLUDED';
  message: string;
  details: { plan: string; limit?: number };
}

export interface Upload {
  id: string;
  purpose: UploadPurpose;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  status: UploadStatus;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  channel: string;
  type: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface ScenarioCatalog {
  scenario_types: Array<{ type: ScenarioType; label: string; description: string }>;
  pressure_modifiers: Array<{ type: PressureModifier; label: string }>;
  communication_style_presets: string[];
  conversation_channel_presets: string[];
}

// ---------- Generic API envelope ----------

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: Record<string, unknown>;
  retry_after_seconds?: number;
}
```

---

## 4. API Integration Strategy

### 4.1 Layering

```
screens/ (UI)
   │ calls hooks
   ▼
hooks/ (TanStack Query hooks — useSessions, useSendMessage, ...)
   │ calls
   ▼
api/ (typed fetch wrappers, one file per backend module: api/sessions.ts, api/personas.ts, ...)
   │ uses
   ▼
lib/httpClient.ts (single Axios/fetch instance: base URL, auth header injection,
                     workspace header injection, 401/402 interception, retry policy)
```

- **TanStack Query (React Query)** owns all server state: caching, background refetch, retry, mutation state. No server data duplicated into a global store (Zustand/Redux) — this avoids the classic two-sources-of-truth bug for data the backend already paginates and caches server-side.
- **Zustand** (small, no boilerplate) owns genuine *client* state: active workspace id, in-flight-session UI state (current scenario/persona picker selections before a session is created), ephemeral simulation UI state (typing indicator, pending optimistic message), auth tokens (persisted via `expo-secure-store`, not AsyncStorage — tokens are sensitive).
- **One Axios instance** (`lib/httpClient.ts`) with interceptors:
  - Request: attach `Authorization`, attach `x-workspace-id` from the active-workspace store.
  - Response error: on `401`, attempt a single silent token refresh (`POST /auth/refresh`) and replay the original request once; on second failure, force logout. On `402`, throw a typed `FeatureGateError` instead of a generic error so calling code (and a global error boundary) can route to the upgrade sheet. On `429`, surface `retry_after_seconds` to the caller rather than a generic "try again."
- **Idempotency keys**: a small `withIdempotencyKey()` helper (uuid v4) wraps `sendMessage`, `createPlaybook`, and `regeneratePlaybook` calls — the only three documented idempotent-safe endpoints. Reused only when React Query retries the exact same mutation attempt, never generated fresh on retry.

### 4.2 Query key conventions

```
['session', sessionId]
['session', sessionId, 'messages', { cursor }]
['sessions', { workspaceId, archived, scenarioType, search, cursor }]
['persona', personaId]
['personas', { workspaceId, cursor }]
['dashboard', workspaceId]
['skillTrend', workspaceId]
['playbooks', { workspaceId, cursor }]
```
Workspace id is always part of the key for workspace-scoped data, so switching workspaces doesn't require manual cache clearing — stale data for the old workspace simply becomes unused and gets garbage-collected by React Query's cache GC.

### 4.3 Loading / empty / error state convention

Every list-backed screen implements the same four states through one shared `<AsyncBoundary>` wrapper (see §10): **loading** (skeleton, not a spinner, for anything with a known shape — session list rows, dashboard cards), **empty** (an illustration + one clear CTA, never just "No data"), **error** (retry button + human message, with the raw error logged, not shown), **partial/stale** (a subtle "updating…" affordance when a background refetch is in flight on data already on screen — never a full-screen spinner over existing content).

### 4.4 Real-time / polling strategy

- **Persona generation status**: subscribe to the Supabase Realtime channel `persona:{personaId}` immediately after a `202` from `POST /personas/from-source`, **and** run a parallel `GET /personas/:id` poll every 3s as a fallback (per the backend's own documented fallback design — see §11 for the exact payload gap). Stop both the moment `generation_status !== 'generating'`.
- **Live-turn**: no realtime involved — a normal mutation with a local "AI is thinking" state for the request's duration.
- **Debrief/scoring after session end**: `POST /:id/end` enqueues async jobs with no push/webhook back to the specific screen. Poll `GET /sessions/:id/debrief` every 3–4s (capped at ~60s / ~15 attempts) while on the debrief-pending screen; stop polling once `debrief !== null`. A push notification (`async_ready_push_enabled` preference) may also arrive — if it does while the debrief screen isn't mounted, tapping it deep-links to the debrief screen, which does one fetch rather than resuming a poll loop.
- **Comparison** (`GET /:id/comparison`) on a retry session: same poll-until-populated pattern, since it depends on both sessions' scores being ready.

### 4.5 Session persistence & recovery

- The Zustand `activeWorkspaceId` and auth tokens persist in `expo-secure-store` across app restarts.
- An **in-progress session** (status `active`, not yet ended) is recoverable purely from the backend — on app foreground/cold-start, if the client has a locally remembered `lastActiveSessionId` (persisted in AsyncStorage, non-sensitive), it fetches `GET /sessions/:id` + the latest message page and resumes the conversation screen directly rather than routing through session setup again. If the session is no longer `active` (ended elsewhere, e.g. web — though no web client exists today — or by the goal-achieved auto-end), route to its debrief instead.
- No local draft persistence is needed for in-flight messages beyond the current text input (append-only API, no offline queue in v1 — see §11 on offline support).

---

## 5. Application Architecture

- **Expo (managed workflow, SDK current stable), React Native, TypeScript (strict mode)** — mirrors the backend's own `tsconfig` strictness philosophy.
- **Navigation:** `expo-router` (file-based routing) — chosen over bare React Navigation because it gives deep-linking (needed for push-notification taps, email-verification redirects, and public playbook share links) essentially for free via the file structure, and the backend already serves web fallback pages for auth links (`webLinks.routes.ts`) that a future deep-link scheme would target.
- **Server state:** TanStack Query v5.
- **Client/UI state:** Zustand (small stores, one per concern: `authStore`, `workspaceStore`, `simulationUiStore`).
- **Forms:** `react-hook-form` + `zod` resolvers — reuses the same validation *shape* as the backend's own Zod schemas (not shared code, since this is a separate package, but the same field names/bounds are mirrored in `src/validation/*.ts` so client-side errors match server-side 400s before a request is even sent).
- **HTTP:** `axios` (interceptor ergonomics) wrapped in a single typed client.
- **Realtime:** `@supabase/supabase-js` (client configured with the anon key, used only for the persona-generation-status Realtime subscription — the app does not otherwise talk to Supabase directly; all data access is via the DryRun API).
- **Secure storage:** `expo-secure-store` for tokens; `@react-native-async-storage/async-storage` for non-sensitive UI/cache state (e.g. `lastActiveSessionId`, onboarding-seen flags).
- **Push:** `expo-notifications` + `expo-server-sdk`-compatible token registered via `POST /notifications/push-token`.
- **Animation:** `react-native-reanimated` + `moti` for the simulation screen's meter/momentum animations (see §8) — kept to these two rather than adding a third animation library.
- **Testing:** Jest + `@testing-library/react-native` for components/hooks; MSW (`msw/native`) for mocking the documented API contracts in isolation so UI tests don't depend on a live backend; a small Detox or Maestro smoke suite for the critical path (signup → instant setup → start session → send message → end → debrief) as a later milestone, not day one.

---

## 6. Navigation Structure

```
RootLayout (expo-router root)
├── (public)/                         — unauthenticated stack
│   ├── welcome                       — marketing/entry screen
│   ├── login
│   ├── signup
│   ├── forgot-password
│   ├── reset-password/[token]        — deep link target
│   ├── verify-email/[token]          — deep link target
│   ├── demo/start                    — anonymous demo entry
│   ├── demo/session                  — anonymous demo conversation
│   ├── demo/replay
│   └── playbook/[token]              — public shared playbook (no auth)
│
├── (auth-gate)                       — redirects based on session validity
│
├── (onboarding)/                     — shown once per workspace until instant-setup complete
│   └── instant-setup
│
└── (app)/                            — authenticated, workspace-resolved
    ├── (tabs)/
    │   ├── home                      — dashboard
    │   ├── practice                  — scenario/persona picker → new session flow
    │   ├── history                   — session list
    │   └── progress                  — skill trend, curriculum, badges
    ├── session/
    │   ├── [id]/new                  — scenario → persona → pressure/goal setup wizard
    │   ├── [id]/live                 — the simulation screen (core experience)
    │   ├── [id]/ending                — natural-ending / goal-achieved transition screen
    │   ├── [id]/debrief               — debrief + skill score reveal
    │   ├── [id]/replay                — full transcript + monologue + heatmap
    │   └── [id]/comparison            — retry vs. original
    ├── persona/
    │   ├── index                     — persona library
    │   ├── new                       — create (manual / text / URL / upload) wizard
    │   └── [id]                      — persona detail / edit
    ├── playbook/
    │   ├── index
    │   └── [id]                      — playbook detail + share sheet
    ├── workspace/
    │   ├── index                     — members, roles, invites
    │   └── settings
    ├── billing/
    │   ├── plans
    │   ├── subscription
    │   └── invoices
    ├── settings/
    │   ├── profile
    │   ├── notifications
    │   └── account                   — export, delete
    └── notifications/
        └── index
```

**Auth gating** sits in `(auth-gate)`: on boot, check for a persisted token → `GET /auth/me`. No token or a failed refresh → `(public)`. Valid token, no `current_workspace_id` or zero workspaces → a lightweight "create/join workspace" step (workspace creation is implied by signup bootstrapping one, per the backend's "admin.createUser atomically creates profile/workspace" note, so this is mostly a fallback path). Valid session + workspace, `onboarding_completed: false` for that workspace → `(onboarding)`. Otherwise → `(app)`.

**Deep links:** `dryrun://playbook/:token` and the web-page equivalents the backend already serves (`/auth/verify-email`, `/auth/reset-password`) should additionally support a custom scheme/universal link so tapping the email link opens the app directly when installed — flagged as a `(app config)` task, not a backend change.

---

## 7. Screen-by-Screen Specification

### 7.1 Welcome / Login / Signup

- **Purpose:** entry point; low-friction demo access alongside signup.
- **Components:** value-prop hero, "Try the demo" CTA (routes to `(public)/demo/start`, no auth), email/password form, Google sign-in button.
- **Data:** none on load.
- **Interactions:** `POST /auth/signup` or `/auth/login`; Google via `expo-auth-session` → `POST /auth/google/callback`.
- **States:** inline field validation (mirrors backend bounds: password 8–72, email format) before submit; loading on submit button only; error banner for `401`/`409`-class failures with the backend's own `message`.

### 7.2 Instant Setup (onboarding)

- **Purpose:** one-time per-workspace product/audience description that every generated persona is built from.
- **Components:** three fields — product description (textarea, 1–1000 chars, live counter), target audience (textarea, same bounds), tone preference (optional, chip picker feeding a ≤300-char free text field).
- **Data:** none to load; `GET /onboarding/status` gates entry (skip if already `true`).
- **Backend:** `POST /onboarding/instant-setup`.
- **States:** standard form loading/error; success routes straight into `(app)` home, not back to a "finish" screen — don't make the founder confirm twice.

### 7.3 Home (Dashboard)

- **Purpose:** the daily landing screen — "what should I practice next."
- **Components:** last-session summary card (tap → debrief or resume if still active), skill-trend sparkline (last 12 points), suggested-curriculum card (tap → prefilled session-setup wizard), team-progress card (owner/admin only).
- **Data:** `GET /dashboard` (single call, cached 5 min server-side — client should still respect normal staleness via React Query's own `staleTime`, not re-fetch aggressively).
- **Empty state:** first-ever visit (`last_session: null`) shows a single prominent "Start your first practice session" CTA instead of empty cards.

### 7.4 Practice / New Session Wizard

Three-step flow (can be a single scroll-and-select screen rather than hard page-per-step, see §8 for the recommended feel):

1. **Scenario** — card grid from `GET /scenarios` (`scenario_types`), each showing `label` + `description`.
2. **Persona** — "Use existing" (searchable list from `GET /personas`) vs. "Create new" (→ persona creation flow, §7.6, which can be entered inline and returns here once ready).
3. **Pressure + goal** — multi-select pressure modifiers (max 2, enforced client-side with the limit visibly reached at 2, not just rejected), difficulty override (optional, defaults to the account's computed difficulty — the wizard should show what the computed default is, sourced from the dashboard/curriculum context, not guess), goal type picker (5 options; `custom` reveals a free-text field, ≤300 chars).

- **Backend:** `POST /sessions`. **Loading UX matters here**: if no `persona_id` was chosen, this call does synchronous AI persona generation server-side and can take several seconds — show a distinct "Building your buyer…" loading state (not a generic spinner) so the wait reads as purposeful, not broken.
- **Feature gate:** a `402 SESSION_LIMIT_REACHED` here routes to the upgrade sheet with the plan/limit from `details`, framed as "you've used your N free sessions this month," not a dead end.

### 7.5 Live Simulation Screen

The core screen — full design treatment in §8. Summary:

- **Data:** the `PracticeSession` + an append-only message list (local state seeded from `GET /sessions/:id/messages` on resume, then grown optimistically on each send).
- **Interactions:** text composer → `POST /sessions/:id/messages`; live interest/trust/momentum meters animate off each response's `live_state`; a `natural_ending` banner offers "wrap up" or "keep going" (`POST /:id/continue`); explicit "End session" action → `POST /:id/end`.
- **Auto-transition:** a response with `goal_achieved: true` immediately routes to `/session/[id]/ending` — no further input accepted.
- **Error states:** a failed send (network or AI-unavailable after the backend's one retry) shows the message as "failed to send" with a retry action reusing the same idempotency key — never duplicates the user's turn.

### 7.6 Persona Library & Creation

- **Library (`persona/index`):** searchable/filterable list (`GET /personas`), each row shows name/role/source-type badge, tap → detail.
- **Creation (`persona/new`):** a segmented choice — Describe manually / Paste text / From a URL / Upload a document — each mapping to the right fields for `POST /personas` (manual) or `POST /personas/from-source` (the other three, sharing one endpoint distinguished by `source_kind`). Upload flow chains through §2.9's signed-URL sequence before calling `from-source` with the resulting `upload_id`.
- **Generating state:** immediately after a `202`, show the "Generating…" placeholder persona card with a subtle pulsing/skeleton treatment, subscribed to the realtime channel + polling fallback (§4.4); transitions to the filled-in card the moment `generation_status` flips.
- **Detail/edit (`persona/[id]`):** editable fields matching `PATCH /personas/:id`'s schema (note: `company_context` is **not** editable per the current API — see §11 — so the edit form should omit that field entirely rather than silently failing to persist it).

### 7.7 Ending Transition

- **Purpose:** a short, deliberate beat between "conversation just ended" and the debrief, used whether the end was goal-achieved, natural-ending-accepted, or manually ended.
- **Components:** a short state summary (final interest/trust reading, goal outcome), a single "See your debrief" CTA.
- **Data:** none new — reuses the last known `live_state` and the session's goal result already in memory; this screen does not block on the async debrief job.

### 7.8 Debrief

- **Purpose:** the "honest read" — the product's core value delivery moment.
- **Components:** strength / improvement / coachable-moment cards, six-axis skill radar or bar chart, weakest/strongest axis callouts, a "Generate playbook from this session" CTA (if it went well), a "Retry this scenario" CTA.
- **Data:** `GET /sessions/:id/debrief` + `GET /sessions/:id` (for `goal_achieved`) — poll pattern from §4.4 while `debrief === null`, with a skeleton/"coaching your results…" state, not a spinner-only screen, during the wait.
- **Empty/pending state:** explicit messaging that scoring runs in the background and a notification will arrive — set expectation rather than let the poll feel broken if it takes 10–20s.

### 7.9 Replay

- **Purpose:** full transcript with the buyer's private monologue revealed per turn — the "what were they actually thinking" payoff.
- **Components:** chat-style transcript, each buyer turn expandable to reveal `internal_monologue` with a `monologue_severity`-colored accent; an interest/trust/confusion line chart built from `heatmap` (the `session_state_snapshots` series).
- **Data:** `GET /sessions/:id/replay` (completed sessions only — gate navigation to this screen on `status === 'completed'`).

### 7.10 Comparison (Retry)

- **Purpose:** the numeric before/after.
- **Components:** side-by-side six-axis bars (original vs retry), per-axis delta chips (colored by sign), the AI-authored one-line `summary`, goal-achieved badges for both attempts.
- **Data:** `GET /sessions/:id/comparison` (called with the **retry** session's id) — poll-until-populated.

### 7.11 History

- **Purpose:** all past sessions, searchable/filterable, archive management.
- **Components:** infinite list (cursor pagination), filter chips (scenario type, archived toggle), search bar.
- **Data:** `GET /sessions` with query params mapped 1:1 to the filter UI.
- **Row actions:** rename, archive/unarchive, delete (only enabled — not just error-on-tap — when `status !== 'completed'`, per the backend's `409` rule), export.

### 7.12 Progress

- **Purpose:** the "staying on track over time" loop made visible.
- **Components:** skill-trend chart (`GET /skill-trend`), per-goal-type achievement rates (`GET /skill-trend/goals`), current curriculum recommendation card with a dismiss action (`POST /curriculum/dismiss`), badge shelf (`GET /badges`).

### 7.13 Playbooks

- **Library:** list with share-status indicator.
- **Detail:** opening message / discovery questions / objection responses / closing CTA / key insight, each independently copyable (tap-to-copy); version history (`GET /:id/versions`); share sheet toggling `share_attribution_enabled` and generating/revoking the `share_token`, with a native share action for the resulting public URL.
- **Public view (`(public)/playbook/[token]`):** read-only rendering of the same content for a non-authenticated visitor — no app-shell chrome, just the content + a "Build your own in DryRun" CTA back to signup.

### 7.14 Workspace / Team

- **Members list** (cursor-paginated), role badges, invite flow (email + role picker, owner/admin only), remove/leave actions, team-progress aggregate view (owner/admin only) — explicitly **never** shows a member's individual sessions, matching the backend's structural privacy boundary; don't build a "view member's sessions" affordance even as a stretch goal.

### 7.15 Billing

- **Plans screen:** plan comparison cards from `GET /billing/plans`, current plan highlighted.
- **Checkout:** `POST /billing/checkout` → open the returned provider URL in an in-app browser (`expo-web-browser`, not the full WebView-as-screen pattern) since Flutterwave's hosted checkout is a web flow; poll `GET /billing/checkout/:ref/status` on return.
- **Subscription management:** cancel (shows `effective_at`, framed as "access continues until"), change plan, reactivate.
- **Invoices:** cursor-paginated list.

### 7.16 Settings

- **Profile:** display name edit.
- **Notifications:** the two preference toggles + a native push-permission prompt entry point.
- **Account:** data export trigger (`GET /user/export`, async — show "we'll notify you" not a progress bar), delete account (soft-delete, with the 14-day recovery window explained plainly in the confirmation copy, and the `409` "transfer ownership first" case surfaced as an actionable message, not a generic error).

### 7.17 Demo (pre-signup)

- **Flow:** category pick (3 presets) → `POST /demo/start` → a simplified simulation screen (no live-state meters, since the demo endpoint doesn't return them — just `reply` + a "N messages left" counter) → `POST /demo/:token/end` → replay → a persistent "Create an account to save this" CTA → `POST /demo/:token/convert`, which returns real IDs the app should deep-link straight into (the new session's debrief or the live screen if still conceptually "continuing"), so the demo investment visibly carries over rather than vanishing into a generic post-signup screen.

---

## 8. The Simulation Experience — Deep Design

This is the screen the whole product lives or dies on, so it gets dedicated treatment beyond the generic screen spec above.

**The problem to design around:** the backend is a plain synchronous POST with no streaming. A naive implementation — type, hit send, stare at a spinner, message pops in — would feel like a form submission, not a conversation. The design has to manufacture a sense of liveness from a request/response primitive.

**Composer & send:**
- Standard chat input pinned to the bottom, safe-area aware, with a send button that disables the instant it's tapped (prevents double-submit even before the idempotency key saves the day server-side).
- On send: the user's message appears **immediately and optimistically** at the bottom of the thread (not waiting for the server echo) — this alone does most of the work of making the screen feel responsive. If the request ultimately fails, that bubble flips to a "failed — tap to retry" state in place, reusing the same idempotency key.

**The "buyer is replying" state:**
- Not a spinner. A buyer-side typing indicator (three-dot bubble, the same visual language as the eventual reply bubble) that holds for the request's duration. Pair it with a **duration-aware label** that changes if the wait crosses ~4s ("thinking it over…") since persona-generation-free live turns are typically fast but can occasionally run long on provider fallback — this keeps a longer-than-usual wait from reading as frozen.

**Live state meters:**
- Interest / trust / confusion rendered as compact animated bars or a small dual-gauge (interest + trust as two tracked lines; confusion as a smaller tertiary indicator, since it's less central to the "is this landing" question than interest/trust). Animate the transition between old and new values with `reanimated` (spring, ~400ms) on every `live_state` update — this is the single biggest "proof something happened" signal in the whole screen, more than the text reply itself, because it's the number moving that makes a specific line's effect visible per the product's own stated value prop.
- **Momentum** is a small trend chip (↑ heating up / → flat / ↓ cooling), not a raw number — `momentum`'s unbounded range makes it a poor fit for a gauge; a 3-state directional indicator derived client-side from the sign and magnitude (e.g. `|momentum| < 2` → flat) communicates it better than the raw figure.
- **Buying intent / objection likelihood**: secondary, revealed on tap/expand of the meter panel rather than always-on — they're per-turn absolute judgments, not trend lines, and showing four to six live numbers at once would clutter the core chat view.

**Natural ending & goal achievement:**
- `natural_ending` surfaces as a dismissible banner above the composer ("This conversation feels like it's winding down") with two actions: "Wrap it up" (→ end flow) and "Keep going" (`POST /:id/continue`, banner dismisses for the session).
- `goal_achieved: true` is **not** a banner — it's an immediate, celebratory full-transition (brief animated confirmation, then auto-navigate to the ending screen within ~1.5s) since the backend has already hard-ended the session server-side; lingering on the chat screen after this would let the user keep typing into a conversation the backend considers over.

**Visual tone:** this is a practice/training product, not a generic messaging app — lean into a slightly more "coached" visual identity than a stock chat UI: the buyer's bubble styling, the meter panel, and the scenario/pressure context (shown as a persistent small header chip, e.g. "Skeptic · Decision-maker watching") should make the *stakes and setup* visible throughout, not just at session start.

---

## 9. Design System

### 9.1 Typography

A single type family (system font via `expo-font` fallback, or a licensed geometric sans if the product wants more identity — not specified by the backend, a product decision) with a restrained scale:

| Token | Size / Weight | Use |
|---|---|---|
| `display` | 28/700 | Debrief hero numbers, onboarding headlines |
| `title` | 22/700 | Screen titles |
| `heading` | 17/600 | Card headers, section labels |
| `body` | 15/400 | Default text, chat bubbles |
| `bodyStrong` | 15/600 | Emphasized body (buyer reply text, slightly heavier than user's own) |
| `caption` | 13/400 | Metadata, timestamps, helper text |
| `micro` | 11/500, letter-spaced | Badges, chips, axis labels |

### 9.2 Color

Token-based (light/dark both defined from day one — do not hardcode hex in components):

- `bg.canvas`, `bg.surface`, `bg.elevated` — layering for cards over screen background.
- `content.primary`, `content.secondary`, `content.tertiary` — text hierarchy.
- `accent.primary` — the product's core brand accent, used sparingly (primary CTA, active tab, the "interest" meter line).
- `signal.positive` / `signal.warning` / `signal.negative` — maps directly to `monologue_severity` and skill-delta coloring (positive delta green-leaning, negative red-leaning, neutral gray) — **one semantic mapping reused everywhere** (debrief deltas, comparison deltas, monologue accents, natural-ending banners) rather than inventing a new color meaning per screen.
- `meter.interest`, `meter.trust`, `meter.confusion` — three distinct, color-blind-safe hues for the live-state meters (don't reuse `signal.*` here — interest/trust are not inherently "good/bad," they're tracked quantities).

### 9.3 Spacing & layout

4px base unit, scale `[4, 8, 12, 16, 24, 32, 48]`. Screen horizontal padding: 16 (phones) / 24 (tablets, if supported). Card radius: 16 for primary cards, 12 for nested/secondary elements, 999 for chips/badges.

### 9.4 Core components (shared, `src/components/ui/`)

`Button` (primary/secondary/ghost/destructive variants, loading state built in), `Card`, `Chip` (selectable + static variants, used for scenario/pressure/goal pickers and axis labels), `MeterBar` (animated, used for interest/trust/confusion), `TrendChip` (momentum indicator), `SkillRadar`/`SkillBarGroup` (six-axis visualization, reused across debrief and comparison), `EmptyState`, `Skeleton` (row/card/text variants), `AsyncBoundary` (wraps React Query loading/error/empty per §4.3), `CursorList` (wraps `FlatList` + `useInfiniteQuery` for every paginated list in the app — one implementation, not five ad hoc `FlatList`s), `BottomSheet` (upgrade prompts, share sheets, filter sheets — `@gorhom/bottom-sheet`), `Avatar`, `Badge`.

### 9.5 Responsive behavior

Phone-first (this is a mobile product; the backend has no web client). Tablet: the two-column opportunity is the session-setup wizard (scenario grid + detail pane side-by-side above ~768pt width) and the comparison screen (side-by-side without stacking). Everything else degrades gracefully to a single centered column with a max content width (~560pt) on larger screens rather than stretching chat bubbles edge-to-edge.

---

## 10. Project Structure

```
app/                          # expo-router routes (see §6) — thin screens only
  (public)/
  (onboarding)/
  (app)/
  _layout.tsx

src/
  api/                        # one file per backend module, typed request fns
    httpClient.ts              # axios instance + interceptors
    auth.ts
    user.ts
    workspace.ts
    onboarding.ts
    dashboard.ts
    scenarios.ts
    personas.ts
    sessions.ts                # includes sendMessage w/ idempotency wrapper
    playbooks.ts
    coaching.ts                # badges, skill-trend, curriculum
    billing.ts
    uploads.ts
    notifications.ts
    demo.ts
    analytics.ts

  hooks/                       # TanStack Query hooks, 1:1 with api/ files
    useSession.ts
    useSendMessage.ts           # the core mutation: optimistic update, idempotency key, error->retry state
    usePersonaGenerationStatus.ts  # realtime + polling fallback combined (§4.4)
    useDebriefPolling.ts
    ...

  stores/                      # Zustand
    authStore.ts
    workspaceStore.ts
    simulationUiStore.ts       # typing indicator, meter animation targets, composer draft

  components/
    ui/                        # design-system primitives (§9.4)
    simulation/                # MeterPanel, TypingBubble, NaturalEndingBanner, ScenarioHeaderChip
    coaching/                  # SkillRadar, DebriefCard, ComparisonBars
    persona/                   # PersonaCard, PersonaGeneratingCard, PersonaSourcePicker
    session/                   # SessionListRow, SessionFilters

  types/
    api.ts                     # entities (§3)
    requests.ts                 # request bodies
    errors.ts                   # ApiErrorBody, FeatureGateError

  validation/                  # zod schemas mirroring backend bounds, for RHF resolvers
    session.ts
    persona.ts
    auth.ts

  theme/                       # tokens (§9), light/dark definitions
  config/                      # env, feature flags, Supabase client init (realtime-only)
  utils/                       # idempotencyKey(), formatDelta(), axisLabel(), cursorPaginationHelpers
  lib/
    supabaseRealtime.ts         # persona:{id} channel subscription helper

assets/
test/
  mocks/                       # MSW handlers mirroring §2 exactly
  components/
  hooks/
```

**Testing strategy:** unit tests for `utils/` (pure functions — delta formatting, idempotency key generation, difficulty-label mapping) and `validation/` (bounds match the backend exactly — a drifted bound here is the kind of bug that silently produces confusing 400s in production); component tests for `components/simulation/*` and `components/coaching/*` (the highest-complexity, highest-value UI); hook tests against MSW-mocked endpoints for the polling/realtime-fallback hooks specifically, since that's the subtlest logic in the app; a thin end-to-end smoke test (Maestro, since it's lighter to maintain than Detox for a small team) covering signup → instant setup → start session → send 2–3 messages → end → debrief, added once the core screens stabilize rather than from day one.

---

## 11. Gaps & Open Questions (backend)

Stated plainly, as the backend's own docs state their gaps — these are genuine ambiguities found while reading the code, not places where I've silently guessed and moved on:

1. **Live monologue is not actually live.** The product description says the buyer's private monologue is "revealed after the session," but `internal_monologue`/`monologue_severity` are absent from both `POST /:id/messages`'s response and `GET /:id/messages`, and only appear via `GET /:id/replay`, which requires `status === 'completed'`. This matches "revealed after," so the frontend design above (§8, §7.9) treats the reveal as a post-session replay feature only — **not** a per-turn reveal during the live screen. If the product intent is actually a per-turn reveal, that needs a backend response-shape change (adding the two fields to the `sendMessage` response) before the frontend can build it.
2. **`source_kind` → required field is unenforced server-side.** `createPersonaFromSourceSchema` doesn't discriminate which of `pasted_text`/`url`/`upload_id` is required per `source_kind`. The frontend's persona-creation form must enforce this client-side (and should validate before sending) since a mismatched payload may not produce a clear server error.
3. **Persona `PATCH` omits `company_context`.** Create accepts it, update doesn't. The persona edit screen (§7.6) should simply not expose this field as editable rather than build UI that silently fails to persist. Worth a backend follow-up if this was unintentional.
4. **Realtime channel payload isn't fully specified.** The `persona:{personaId}` channel naming convention is documented in code comments, but the exact event/payload shape (a row-level `UPDATE` broadcast vs. a custom event) isn't visible from the routes/services read. The hook design in §4.4 treats the realtime subscription as "refetch `GET /personas/:id` whenever anything arrives on this channel" rather than trusting a specific payload shape — this is a safe, decoupled design regardless of the exact payload, but should be confirmed against the actual `realtime/` channel-publishing code before implementation.
5. **`POST /:id/continue`'s extra-exchange budget (3) is not server-enforced** in the files reviewed — it's a constant returned for the client to display and self-police. If the backend later adds enforcement, no frontend change should be needed (client already treats it as a soft budget), but don't assume the server will reject a 4th message after a dismissed natural-ending today.
6. **Demo session responses don't appear to include `live_state`.** The demo's `POST /:token/messages` response per the research is `{ reply, messages_remaining }` only — no interest/trust/momentum. §7.17 designs the demo screen without meters accordingly; if the backend does return more fields than documented here, the demo screen is an easy, low-risk place to add the meters later (no architecture change needed, just a richer response to render).
7. **No offline queue / background send.** The backend has no mechanism for a client to queue a message sent while offline and have it land later in correct `sequence_index` order beyond the atomic-allocation guarantee for concurrent *online* requests. v1 frontend scope (§10) deliberately does not include offline message queuing — a failed send due to no connectivity surfaces as a retry-able failed bubble (§8), not a silent background queue. This is a scope decision, not a backend bug, but worth stating since "session persistence and recovery" was explicitly requested: recovery here means resuming an in-progress session's *state*, not replaying offline-composed messages.
8. **No automated backend test suite exists** (`ARCHITECTURE.md` §14 states this plainly). This doesn't change frontend architecture directly, but means the frontend's own contract tests (MSW handlers mirrored exactly to this document, per §10) are the only thing currently guarding against silent backend response-shape drift — worth keeping deliberately in sync as the backend evolves, since there's no generated OpenAPI spec or shared types package between the two codebases today.
9. **No shared types package.** Backend is TypeScript; frontend is TypeScript; there is currently no mechanism (tRPC, generated OpenAPI client, shared `packages/types`) keeping the two in sync automatically. The types in §3 are hand-derived from the backend source as of this document's writing and will drift if either side changes without updating the other. A follow-up worth considering once the frontend build starts in earnest: a lightweight shared-types package or an OpenAPI generation step from the Zod schemas, so this document (and the generated `src/types/api.ts`) doesn't silently rot.

---

## 12. Implementation Milestones

Each milestone is independently shippable to an internal build; later milestones depend on earlier ones as noted.

### M0 — Foundations (no dependencies)
- Expo project scaffold, TypeScript strict config, `expo-router` structure (§6 skeleton, empty screens).
- `httpClient.ts` with auth/workspace header injection and the 401-refresh / 402-feature-gate interceptors.
- Design tokens (§9.1–9.3) and the core `components/ui/` primitives (§9.4), built against static/mock data.
- MSW mock handlers covering every endpoint in §2, so later milestones can build against a stable contract before the real backend is wired in CI.
- **Acceptance:** app boots to an empty shell with working navigation between placeholder screens; design-system components render correctly in a Storybook-equivalent (Expo-compatible component gallery screen) in both light/dark.

### M1 — Auth & Workspace (depends on M0)
- Login/signup/forgot-password/reset flows, token persistence (`expo-secure-store`), the auth-gate redirect logic.
- Workspace resolution, switcher, and the `workspaceStore`.
- Google OAuth via `expo-auth-session`.
- **Acceptance:** a new user can sign up, verify email (via the backend's web fallback page, confirmed reachable from a test device), log in, and land in the app with a resolved workspace; token refresh survives an app restart; logout clears state correctly.

### M2 — Onboarding & Dashboard (depends on M1)
- Instant Setup screen + `GET /onboarding/status` gating.
- Dashboard screen wired to `GET /dashboard`, including the empty/first-run state.
- **Acceptance:** a fresh workspace routes through Instant Setup exactly once, then lands on a dashboard that correctly reflects zero sessions, and re-entering the app afterward skips onboarding.

### M3 — Persona Library (depends on M1)
- Persona list, manual creation, all three from-source creation paths (text/URL/upload, including the signed-upload flow, §2.9), the generating-status realtime+polling hook (§4.4), edit/delete.
- **Acceptance:** all four creation paths produce a usable, `ready` persona visible in the library; a slow (`url`/`upload`) generation correctly shows the generating state and transitions without a manual refresh; an interrupted realtime connection still resolves via polling within the fallback interval.

### M4 — Core Simulation Loop (depends on M3) — **the critical milestone**
- Session setup wizard (§7.4), the live simulation screen in full (§8), end flow, ending transition, and session recovery on app relaunch (§4.5).
- **Acceptance:** a user can complete scenario→persona→pressure/goal setup, hold a multi-turn conversation with correctly animating live-state meters, trigger and respond to a natural-ending signal, reach goal-achieved auto-completion, and manually end a session — all without the UI ever allowing a send into a non-active session; killing and relaunching the app mid-conversation resumes the same screen with full history.

### M5 — Debrief, Replay, Retry/Comparison (depends on M4)
- Debrief polling screen, replay (transcript + monologue + heatmap), retry flow, comparison screen.
- **Acceptance:** ending a session reliably surfaces a debrief within the expected async window with correct pending-state messaging; replay correctly gates on completed status; a retry session correctly reuses the same persona and its comparison screen populates once both sessions are scored.

### M6 — Coaching Layer (depends on M5)
- Progress screen (skill trend, goal rates, curriculum, badges), playbook generation/detail/share (including the public unauthenticated view), history screen with full filtering.
- **Acceptance:** a completed, well-performing session can be turned into a playbook, shared via link, and viewed correctly by a logged-out visitor on that link; curriculum recommendations are dismissible and feed back into the setup wizard.

### M7 — Workspace, Billing, Settings (depends on M1, parallelizable with M3–M6)
- Team management, billing (plans/checkout/subscription/invoices) including the feature-gate upgrade-sheet flow wired to every `402` surfaced anywhere in the app, account settings (export, delete/recover).
- **Acceptance:** a feature-gated action anywhere in the app (session start, playbook generation, document-based persona) routes to a consistent upgrade sheet reflecting the correct plan/limit; checkout completes against the sandboxed payment provider end-to-end; account deletion and recovery both work within the grace window.

### M8 — Demo Funnel & Push (depends on M0, parallelizable)
- Public demo flow (§7.17) and the convert-to-account bridge into the real app.
- Push notification registration and the debrief/weekly-summary notification handling, including deep-linking a tapped notification to the right screen.
- **Acceptance:** an anonymous visitor can complete a full demo conversation and convert it into a real account that opens directly to that session's (now real) debrief; a push notification for a ready debrief correctly deep-links into that session when the app is backgrounded or closed.

### M9 — Polish & Hardening (depends on all above)
- Full light/dark pass, tablet layout pass (§9.5), accessibility pass (dynamic type, screen-reader labels on meters/charts, color-blind-safe meter palette already specified in §9.2), error-boundary and crash-reporting wiring, Maestro smoke suite (§10), performance pass on the simulation screen's animation layer.
- **Acceptance:** the critical-path smoke test is green in CI; the app meets baseline accessibility checks; cold-start and session-screen frame timing are measured and within target on a mid-tier device.
