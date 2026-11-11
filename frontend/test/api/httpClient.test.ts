import { httpClient } from '@/api/httpClient';

import { mockAuthTokens, mockUser } from '../mocks/data';

describe('httpClient', () => {
  it('reaches the mocked /auth/login endpoint and parses the session response', async () => {
    // POST /auth/login returns session fields only, no `user` — see
    // src/types/auth.ts's header comment.
    const response = await httpClient.post('/auth/login', {
      email: mockUser.email,
      password: 'password123',
    });

    expect(response.status).toBe(200);
    expect(response.data.access_token).toBe(mockAuthTokens.access_token);
    expect(response.data.user).toBeUndefined();
  });

  it('reaches /auth/me and gets the user wrapped in { user }', async () => {
    const response = await httpClient.get('/auth/me');
    expect(response.status).toBe(200);
    expect(response.data.user.email).toBe(mockUser.email);
  });
});
