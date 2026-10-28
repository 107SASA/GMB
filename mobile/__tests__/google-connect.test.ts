jest.mock('@/app/_layout', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('@/api/client', () => ({
  api: { post: jest.fn() },
  getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })) }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `mobile://${path}` }));

import * as WebBrowser from 'expo-web-browser';

import { api } from '@/api/client';
import { openGoogleConnect } from '@/lib/connectGoogle';

const HANDOFF = `https://growwmatics.com/api/auth/google/mobile-handoff/${'a'.repeat(64)}`;
const post = api.post as jest.Mock;
const mockInvalidateQueries = jest.requireMock('@/app/_layout').queryClient.invalidateQueries as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

it('asks the backend for a single-use link and opens it in an auth session (Android: no web session needed in Chrome)', async () => {
  post.mockResolvedValueOnce({ data: { url: HANDOFF, expiresAt: '2026-10-24T10:02:00.000Z' } });

  await openGoogleConnect();

  expect(post).toHaveBeenCalledWith('/api/auth/google/mobile-handoff');
  expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(HANDOFF, 'mobile://google-connected', {
    preferEphemeralSession: true,
  });
  expect(mockInvalidateQueries).toHaveBeenCalled();
});

it('never opens the cookie-dependent /api/auth/google route directly', async () => {
  post.mockResolvedValueOnce({ data: { url: HANDOFF, expiresAt: '2026-10-24T10:02:00.000Z' } });
  await openGoogleConnect();
  const opened = (WebBrowser.openAuthSessionAsync as jest.Mock).mock.calls[0][0] as string;
  expect(opened).not.toMatch(/\/api\/auth\/google$/);
});

it('does not open a browser when the handoff request fails', async () => {
  post.mockRejectedValueOnce(new Error('403'));
  await expect(openGoogleConnect()).rejects.toThrow('403');
  expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
});

it('rejects a malformed handoff response instead of opening it', async () => {
  post.mockResolvedValueOnce({ data: { url: 'not a url' } });
  await expect(openGoogleConnect()).rejects.toBeTruthy();
  expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
});
