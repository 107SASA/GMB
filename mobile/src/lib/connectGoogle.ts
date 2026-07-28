import { Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

/**
 * Shared "connect Google Business Profile" prompt — GBP OAuth has no native
 * mobile flow, so this opens the web dashboard's `/api/auth/google` route in
 * an in-app browser. Used wherever a workspace-scoped GBP call comes back
 * not-connected (reviews sync, media, dashboard, etc).
 */
export function promptConnectGoogle(message: string): void {
  Alert.alert('Connect Google Business Profile', message, [
    { text: 'Not now', style: 'cancel' },
    {
      text: 'Connect',
      onPress: () => void WebBrowser.openBrowserAsync(`${process.env.EXPO_PUBLIC_API_URL}/api/auth/google`),
    },
  ]);
}
