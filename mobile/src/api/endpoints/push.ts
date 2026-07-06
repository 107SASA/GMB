import { api } from '../client';

/** POST /api/user/push-token — registers this device's Expo push token. */
export async function registerPushToken(token: string): Promise<void> {
  await api.post('/api/user/push-token', { token });
}

/** DELETE /api/user/push-token — call on logout so this device stops receiving pushes. */
export async function removePushToken(token: string): Promise<void> {
  await api.delete('/api/user/push-token', { data: { token } });
}
