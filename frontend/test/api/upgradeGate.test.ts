import { http, HttpResponse } from 'msw';

import { httpClient } from '@/api/httpClient';
import { useUpgradeStore } from '@/stores/upgradeStore';
import { isFeatureGateException } from '@/types/errors';

import { server } from '../mocks/server';

describe('feature-gate 402', () => {
  beforeEach(() => useUpgradeStore.getState().dismiss());

  it('rejects with a FeatureGateException and opens the global upgrade sheet', async () => {
    const body = { error: 'SESSION_LIMIT_REACHED', message: 'Limit', details: { plan: 'free', limit: 4 } };
    server.use(http.post(/\/sessions$/, () => HttpResponse.json(body, { status: 402 })));

    const err = await httpClient.post('/sessions', {}).then(() => null, (e: unknown) => e);
    expect(isFeatureGateException(err)).toBe(true);
    expect(useUpgradeStore.getState().gate?.error).toBe('SESSION_LIMIT_REACHED');
  });
});
