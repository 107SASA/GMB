import { Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { queryClient } from '@/app/_layout';

/**
 * Shared "connect Google Business Profile" prompt — GBP OAuth has no native
 * mobile flow, so this opens the web dashboard's `/api/auth/google` route in
 * an in-app browser. Used wherever a workspace-scoped GBP call comes back
 * not-connected (reviews sync, media, dashboard, etc).
 *
 * `openBrowserAsync`'s promise resolves once the user dismisses the in-app
 * browser (there's no custom-scheme redirect wired up to intercept
 * completion earlier) — previously nothing happened at that point, so every
 * GBP-dependent screen (Settings' connection row, GBP tabs, Photos) kept
 * showing "not connected" until a manual pull-to-refresh or the global 60s
 * staleTime happened to lapse, even though the connection had actually
 * succeeded. Invalidating everything on return mirrors the pull-to-refresh
 * pattern already used elsewhere (e.g. dashboard.tsx) — this is a rare,
 * deliberate action, not a hot path, so a full refetch is cheap here.
 */
export function promptConnectGoogle(message: string): void {
  Alert.alert('Connect Google Business Profile', message, [
    { text: 'Not now', style: 'cancel' },
    {
      text: 'Connect',
      onPress: () => {
        void WebBrowser.openBrowserAsync(`${process.env.EXPO_PUBLIC_API_URL}/api/auth/google`).then(() => {
          void queryClient.invalidateQueries({ predicate: () => true });
        });
      },
    },
  ]);
}
