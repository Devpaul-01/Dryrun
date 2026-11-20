import AsyncStorage from '@react-native-async-storage/async-storage';
import { http, HttpResponse } from 'msw';

import { getStoredPushToken, registerForPush } from '@/utils/push';

import { server } from '../mocks/server';

const mockPerm = jest.fn();
const mockRequest = jest.fn();
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...a: unknown[]) => mockPerm(...a),
  requestPermissionsAsync: (...a: unknown[]) => mockRequest(...a),
  getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[abc]' }),
  setNotificationChannelAsync: async () => undefined,
  AndroidImportance: { DEFAULT: 3 },
  setNotificationHandler: () => undefined,
}));

describe('registerForPush', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockPerm.mockReset();
    mockRequest.mockReset();
  });

  it('registers the token with the backend and stores it for logout', async () => {
    let body: unknown;
    server.use(http.post(/\/notifications\/push-token$/, async ({ request }) => { body = await request.json(); return HttpResponse.json({ success: true }); }));
    mockPerm.mockResolvedValue({ status: 'granted' });

    const r = await registerForPush();

    expect(r).toEqual({ status: 'registered', token: 'ExponentPushToken[abc]' });
    expect(body).toEqual({ token: 'ExponentPushToken[abc]' });
    expect(await getStoredPushToken()).toBe('ExponentPushToken[abc]');
  });

  it('reports denied without calling the backend', async () => {
    mockPerm.mockResolvedValue({ status: 'undetermined' });
    mockRequest.mockResolvedValue({ status: 'denied' });
    expect(await registerForPush()).toEqual({ status: 'denied' });
    expect(await getStoredPushToken()).toBeUndefined();
  });

  it('reports error when registration fails', async () => {
    server.use(http.post(/\/notifications\/push-token$/, () => HttpResponse.json({ error: 'X', message: 'x' }, { status: 500 })));
    mockPerm.mockResolvedValue({ status: 'granted' });
    expect((await registerForPush()).status).toBe('error');
  });
});
