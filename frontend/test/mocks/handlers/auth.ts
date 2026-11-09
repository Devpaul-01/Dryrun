import { HttpResponse, http } from 'msw';

import { env } from '@/config/env';

import { mockAuthTokens, mockUser } from '../data';

const API = env.apiRoot;

export const authHandlers = [
  http.post(`${API}/auth/signup`, async () => {
    return HttpResponse.json({ user: mockUser, ...mockAuthTokens }, { status: 201 });
  }),

  http.post(`${API}/auth/login`, async () => {
    return HttpResponse.json({ user: mockUser, ...mockAuthTokens });
  }),

  http.post(`${API}/auth/refresh`, async () => {
    return HttpResponse.json(mockAuthTokens);
  }),

  http.get(`${API}/auth/me`, async () => {
    return HttpResponse.json(mockUser);
  }),

  http.post(`${API}/auth/logout`, async () => {
    return new HttpResponse(null, { status: 204 });
  }),
];
