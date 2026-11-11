/**
 * Fixture data shared by MSW handlers. Shapes match src/types/api.ts
 * exactly — kept here, not inline in handlers, so tests can import and
 * assert against the same objects the mocked server returns.
 */

import type { User, Workspace } from '@/types/api';

export const mockUser: User = {
  id: 'user_1',
  email: 'founder@example.com',
  display_name: 'Seyi',
  current_workspace_id: 'workspace_1',
  email_verified_at: '2026-01-01T00:00:00.000Z',
  onboarding_completed_at: '2026-01-01T00:05:00.000Z',
  is_admin: false,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:05:00.000Z',
};

export const mockWorkspace: Workspace = {
  id: 'workspace_1',
  name: "Seyi's Workspace",
  owner_user_id: 'user_1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

export const mockAuthTokens = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
};
