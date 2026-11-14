import { queryClient } from '@/api/queryClient';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { AccountDeletedException, EmailNotVerifiedException } from '@/types/errors';

const body = { error: 'X', message: 'x' };

describe('queryClient session-blocking error handling', () => {
  afterEach(async () => {
    await useAuthStore.getState().clearTokens();
    await useWorkspaceStore.getState().clear();
    queryClient.clear();
  });

  it('refreshes the user when any query hits EMAIL_NOT_VERIFIED, without retrying', async () => {
    queryClient.setQueryData(['me'], { id: 'u1' });
    let calls = 0;

    await queryClient
      .fetchQuery({
        queryKey: ['sessions', 'ws_1'],
        queryFn: () => {
          calls += 1;
          throw new EmailNotVerifiedException(body);
        },
        retry: queryClient.getDefaultOptions().queries?.retry,
        retryDelay: 0,
      })
      .catch(() => undefined);

    expect(calls).toBe(1);
    expect(queryClient.getQueryState(['me'])?.isInvalidated).toBe(true);
  });

  it('signs out locally when a mutation hits ACCOUNT_DELETED', async () => {
    await useAuthStore.getState().setTokens({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await useWorkspaceStore.getState().setActiveWorkspaceId('ws_1');

    await queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationFn: async () => {
          throw new AccountDeletedException(body);
        },
      })
      .execute(undefined)
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAuthStore.getState().tokens).toBeNull();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
  });
});
