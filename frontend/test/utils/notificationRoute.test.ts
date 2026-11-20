import { notificationRoute, notificationText } from '@/utils/notificationRoute';

describe('notificationRoute', () => {
  it('opens the debrief for debrief_ready using sessionId', () => {
    expect(notificationRoute('debrief_ready', { sessionId: 's1' })).toBe('/(app)/session/s1/debrief');
  });
  it('accepts snake_case session ids too', () => {
    expect(notificationRoute('debrief_ready', { session_id: 's2' })).toBe('/(app)/session/s2/debrief');
  });
  it('returns null when a debrief notification has no session', () => {
    expect(notificationRoute('debrief_ready', {})).toBeNull();
    expect(notificationRoute('debrief_ready', null)).toBeNull();
  });
  it('routes billing and weekly summary', () => {
    expect(notificationRoute('payment_failed', {})).toBe('/(app)/billing/subscription');
    expect(notificationRoute('weekly_summary', {})).toBe('/(app)/(tabs)/progress');
  });
  it('ignores unknown types', () => {
    expect(notificationRoute('something_new', { sessionId: 's1' })).toBeNull();
  });
});

describe('notificationText', () => {
  it('reads title/body with fallbacks', () => {
    expect(notificationText({ title: 'T', body: 'B' })).toEqual({ title: 'T', body: 'B' });
    expect(notificationText(null)).toEqual({ title: 'Notification', body: '' });
  });
});
