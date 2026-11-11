/**
 * Request body types for every mutating/parameterized endpoint in
 * docs/FRONTEND_ARCHITECTURE.md §2. Bounds in comments mirror the backend's
 * own validation so client-side zod schemas (src/validation/*.ts) can match
 * them exactly — see §11.9 on keeping this in sync by hand.
 */

import type {
  DifficultyLevel,
  GoalType,
  PressureModifier,
  ScenarioType,
  PersonaSourceKind,
  UploadPurpose,
  WorkspaceRole,
} from './api';

// ---------- Auth ----------

export interface SignupRequest {
  email: string;
  password: string; // 8-72
  displayName?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refresh_token: string;
}

export interface LogoutRequest {
  pushToken?: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string; // 8-72
}

export interface VerifyEmailRequest {
  token: string;
}

// Body is `z.object({}).optional()` server-side — kept as a named,
// empty-object type (rather than inlining {}) so call sites read the
// same way as every other auth request.
export type ResendVerificationRequest = Record<string, never>;

export interface RecoverAccountRequest {
  email: string;
  password: string;
}

export interface GoogleCallbackRequest {
  access_token: string;
}

// ---------- User ----------

export interface UpdateUserRequest {
  display_name?: string; // 1-120
}

export interface NotificationPreferencesRequest {
  weekly_summary_enabled?: boolean;
  async_ready_push_enabled?: boolean;
}

// ---------- Workspace ----------

export interface SwitchWorkspaceRequest {
  workspace_id: string;
}

export interface UpdateWorkspaceRequest {
  name?: string; // 1-200
}

export interface CreateInviteRequest {
  email: string;
  role: Extract<WorkspaceRole, 'admin' | 'member'>;
}

export interface UpdateMemberRoleRequest {
  role: WorkspaceRole;
}

export interface TransferOwnershipRequest {
  newOwnerUserId: string;
}

// ---------- Onboarding ----------

export interface InstantSetupRequest {
  product_description: string; // 1-1000
  target_audience: string; // 1-1000
  tone_preference?: string; // <=300
}

// ---------- Personas ----------

export interface CreatePersonaRequest {
  scenario_type?: ScenarioType;
  name: string;
  role: string;
  company_context?: string | null;
  main_pain: string;
  skepticism_about: string;
  communication_style: string;
  hidden_motivations?: string[];
  reusable?: boolean;
}

export interface CreatePersonaFromSourceRequest {
  scenario_type: ScenarioType;
  source_kind: PersonaSourceKind;
  // Exactly one of the following three must be set, matching source_kind —
  // the backend does NOT enforce this; see architecture doc §11 item 2.
  pasted_text?: string;
  url?: string;
  upload_id?: string;
}

export interface UpdatePersonaRequest {
  name?: string;
  role?: string;
  // company_context intentionally omitted — PATCH does not accept it
  // server-side (architecture doc §11 item 3); not exposed as editable.
  main_pain?: string;
  skepticism_about?: string;
  communication_style?: string;
  hidden_motivations?: string[];
  reusable?: boolean;
}

// ---------- Sessions ----------

export interface CreateSessionRequest {
  scenario_type: ScenarioType;
  pressure_modifiers?: PressureModifier[]; // max 2
  difficulty_override?: DifficultyLevel;
  persona_id?: string;
  goal?: {
    goal_type: GoalType;
    custom_text?: string;
  };
}

export interface UpdateSessionRequest {
  title: string; // 1-200
}

export interface ListSessionsRequest {
  cursor?: string;
  limit?: number;
  archived?: boolean;
  scenario_type?: ScenarioType;
  search?: string;
}

export interface SendMessageRequest {
  content: string; // 1-4000 chars
  attachment_upload_ids?: string[]; // uuids, max 5
}

export interface SetSessionGoalRequest {
  goal_type: GoalType;
  custom_text?: string;
}

export interface AddSessionAttachmentsRequest {
  upload_ids: string[]; // 1-5
}

export type SessionExportFormat = 'json' | 'text';

// ---------- Playbooks ----------

export interface CreatePlaybookRequest {
  persona_id?: string;
  session_id?: string;
  title?: string; // <=200
}

export interface SharePlaybookRequest {
  attribution_enabled?: boolean;
}

// ---------- Curriculum ----------

export interface DismissCurriculumRequest {
  curriculum_id: string;
}

// ---------- Billing ----------

export interface CheckoutRequest {
  plan_key: string;
}

export interface ChangePlanRequest {
  plan_key: string;
}

// ---------- Uploads ----------

export interface SignedUrlRequest {
  purpose: UploadPurpose;
  filename: string; // 1-255
  mime_type: string;
  size_bytes: number; // <=10MB
}

// ---------- Notifications ----------

export interface RegisterPushTokenRequest {
  token: string;
}

// ---------- Demo ----------

export interface DemoStartRequest {
  fingerprint: string; // 1-200
  category?: 'saas' | 'services' | 'physical_product';
}

export interface DemoMessageRequest {
  content: string; // 1-2000
}

export interface DemoConvertRequest {
  email: string;
  password: string; // >=8
}

// ---------- Analytics ----------

export interface AnalyticsEventRequest {
  event_name: string; // 1-100
  properties?: Record<string, unknown>;
  session_id?: string;
}
