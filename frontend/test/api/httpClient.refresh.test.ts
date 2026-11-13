import { HttpResponse, http } from 'msw';

import { httpClient } from '@/api/httpClient';
import { env } from '@/config/env';
import { useAuthStore } from '@/stores/authStore';

import { server } from '../mocks/server';

const API = env.apiRoot;

/**
 * M1 acceptance criteria: "token refresh survives an app restart" depends
 * on the 401-refresh-and-replay interceptor actually working, not just
 * the storage round-trip (test/stores/authStore.test.ts covers that half
 * separately). This exercises httpClient.ts's real interceptor against a
 * mocked backend that rejects the original access token once, then
 * accepts whatever the client sends after refreshing.
 */
describe('httpClient 401 refresh-and-replay', () => {
  beforeEach(async () => {
    await useAuthStore.getState().setTokens({
      accessToken: 'stale-access-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
    });
  });

  afterEach(async () => {
    await useAuthStore.getState().clearTokens();
  });

  it('refreshes the access token on a 401 and replays the original request once', async () => {
    let meCallCount = 0;

    server.use(
      http.get(`${API}/auth/me`, ({ request }) => {
        meCallCount += 1;
        const auth = request.headers.get('Authorization');
        if (auth === 'Bearer stale-access-token') {
          return HttpResponse.json(
            { error: 'UNAUTHORIZED', message: 'Token expired.' },
            { status: 401 },
          );
        }
        if (auth === 'Bearer fresh-access-token') {
          return HttpResponse.json({ user: { id: 'user_1', email: 'a@b.com' } });
        }
        return HttpResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
      }),
      http.post(`${API}/auth/refresh`, async ({ request }) => {
        const body = (await request.json()) as { refresh_token: string };
        expect(body.refresh_token).toBe('valid-refresh-token');
        return HttpResponse.json({
          access_token: 'fresh-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        });
      }),
    );

    const response = await httpClient.get('/auth/me');

    expect(response.status).toBe(200);
    expect(meCallCount).toBe(2); // original 401 + replayed success
    expect(useAuthStore.getState().tokens?.accessToken).toBe('fresh-access-token');
    expect(useAuthStore.getState().tokens?.refreshToken).toBe('rotated-refresh-token');
  });

  it('clears tokens when the refresh call itself fails (refresh token also invalid)', async () => {
    server.use(
      http.get(`${API}/auth/me`, () =>
        HttpResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
      ),
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ error: 'UNAUTHORIZED', message: 'Refresh token invalid.' }, { status: 401 }),
      ),
    );

    await expect(httpClient.get('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().tokens).toBeNull();
  });
});
