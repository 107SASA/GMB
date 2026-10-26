import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type * as NotificationsTypes from 'expo-notifications';

import { registerPushToken, removePushToken } from '@/api/endpoints/push';

const PUSH_TOKEN_KEY = 'push_token';

// Remote push was removed from Expo Go in SDK 53 — importing expo-notifications
// there throws at module load, so it must only ever be require()d behind this
// guard. Web doesn't support the notification APIs either.
const isExpoGo = Constants.executionEnvironment === 'storeClient';
export const pushSupported = !isExpoGo && Platform.OS !== 'web';

const Notifications: typeof NotificationsTypes | null = pushSupported
  ? require('expo-notifications')
  : null;

// Show notifications while the app is foregrounded too (banner, no badge).
Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Deep-link data of the notification tap that opened the app, or null where
 * notifications are unavailable (Expo Go, web). Safe to call unconditionally:
 * which implementation is exported is fixed for the app's lifetime.
 */
export const useLastNotificationResponse: () =>
  | NotificationsTypes.NotificationResponse
  | null
  | undefined = Notifications
  ? Notifications.useLastNotificationResponse
  : () => null;

/**
 * Registers this device for push and uploads the token to the backend.
 *
 * - promptIfNeeded=true: used right after an explicit login — may show the
 *   OS permission dialog.
 * - promptIfNeeded=false: used on session restore — only registers when
 *   permission was already granted, so the app never prompts on plain open.
 *
 * Best-effort by design: simulators, Expo Go, web, and missing EAS config
 * all make push unavailable — the app must work fine without it.
 */
export async function registerForPushNotifications(promptIfNeeded: boolean): Promise<void> {
  try {
    if (!Notifications) return; // Expo Go / web — no push
    if (!Device.isDevice) return; // no push on simulators

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      if (!promptIfNeeded) return;
      status = (await Notifications.requestPermissionsAsync()).status;
      if (status !== 'granted') return;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    await registerPushToken(token);
    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token).catch(() => {});
  } catch (e) {
    console.warn('[push] registration skipped:', e);
  }
}

/**
 * Removes this device's token server-side (must run while still
 * authenticated) and forgets it locally. Called from logout.
 */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY).catch(() => null);
    if (!token) return;
    await removePushToken(token);
  } catch {
    // Offline logout etc. — dead tokens also get pruned server-side on send.
  } finally {
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY).catch(() => {});
  }
}
