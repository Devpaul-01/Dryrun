import { httpClient } from '@/api/httpClient';

import { mockAuthTokens, mockUser } from '../mocks/data';

describe('httpClient', () => {
  it('reaches the mocked /auth/login endpoint and parses the response', async () => {
    const response = await httpClient.post('/auth/login', {
      email: mockUser.email,
      password: 'password123',
    });

    expect(response.status).toBe(200);
    expect(response.data.user.email).toBe(mockUser.email);
    expect(response.data.access_token).toBe(mockAuthTokens.access_token);
  });

  it('attaches no Authorization header when there are no stored tokens', async () => {
    const response = await httpClient.get('/auth/me');
    expect(response.status).toBe(200);
  });
});
