/**
 * Entity and enum types mirroring the backend's Postgres schema and API
 * response shapes exactly (see docs/FRONTEND_ARCHITECTURE.md §3).
 *
 * Field names are intentionally left snake_case — the backend returns them
 * as-is, and remapping to camelCase here invites drift. Maintained by hand
 * against the architecture doc, not inferred from live responses.
 */

// ---------- Enums (exact backend values) ----------

export type ScenarioType =
  | 'cold_open'
  | 'skeptic'
  | 'price_pushback'
  | 'bad_timing'
  | 'long_goodbye'
  | 'radio_silence'
  | 'drill';

export type PressureModifier =
  | 'decision_maker_watching'
  | 'competitor_mentioned'
  | 'rushed_impatient'
  | 'compliance_concern';

export type DifficultyLevel = 'beginner' | 'standard' | 'advanced' | 'expert';

export type GoalType =
  | 'book_meeting'
  | 'yes_no_budget'
  | 'uncover_objection'
  | 'get_reply'
  | 'custom';

export type SessionStatus = 'pending' | 'active' | 'completed'; // + orthogonal archived_at

export type MessageRole = 'user' | 'buyer' | 'system';

export type MonologueSeverity = 'positive' | 'neutral' | 'negative';

export type PersonaGenerationStatus = 'generating' | 'ready' | 'failed';
export type PersonaSourceType =
  | 'generated'
  | 'linkedin_text'
  | 'company_url'
  | 'sales_page'
  | 'job_description'
  | 'email_thread'
  | 'document'
  | 'image'
  | 'combined';
export type PersonaSourceKind = 'pasted_text' | 'url' | 'upload';

export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type WorkspaceMemberStatus = 'active' | 'invited' | 'removed';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete';
export type UploadPurpose = 'persona_source' | 'session_context';
export type UploadStatus = 'uploaded' | 'processing' | 'processed' | 'failed';

export type SkillAxisKey =
  | 'clarity'
  | 'value'
  | 'discovery'
  | 'objection_handling'
  | 'brevity'
  | 'cta_strength';

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
  name: string; // 'Generating…' while generation_status === 'generating'
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
export interface PersonaSnapshot
  extends Omit<Persona, 'id' | 'workspace_id' | 'created_by_user_id'> {
  interest_score?: number; // seeds live_state.interest at session start (default 30)
  trust_score?: number; // seeds live_state.trust at session start (default 15)
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
  interest: number; // 0-100 cumulative
  trust: number; // 0-100 cumulative
  confusion: number; // 0-100 cumulative
  buying_intent: number; // 0-100 per-turn
  objection_likelihood: number; // 0-100 per-turn
  momentum: number; // unbounded rolling mean
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
  sessions: Array<{
    scenario_type: ScenarioType;
    difficulty_level?: DifficultyLevel;
    reason?: string;
  }>;
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
  error:
    | 'SESSION_LIMIT_REACHED'
    | 'PLAYBOOK_LIMIT_REACHED'
    | 'PERSONA_FROM_DOCUMENT_NOT_INCLUDED'
    | 'VOICE_MODE_NOT_INCLUDED';
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
