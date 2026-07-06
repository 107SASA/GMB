import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Platform, Pressable, Text, View } from 'react-native';

import {
  BackChevron, EmptyState, Screen
} from '@/components/ui';
import { useMobileFlags } from '@/lib/featureFlags';

/**
 * PLAN B — READ_CALL_LOG-based lead capture (Android only). INTENTIONALLY A
 * PLACEHOLDER in this release.
 *
 * STORE COMPLIANCE — read before implementing (also in mobile/README.md):
 *  - Google Play requires a Permissions Declaration Form for READ_CALL_LOG /
 *    READ_PHONE_STATE and rejects most non-dialer apps that request them.
 *    The first release must ship WITHOUT these permissions in the merged
 *    manifest — do NOT add react-native-call-log (or any lib that injects
 *    the permission) until the declaration is filed and approved.
 *  - This screen is doubly gated: the remote androidCallLogCapture flag
 *    (default OFF, served by /api/mobile/flags) AND Platform.OS === 'android'.
 *  - iOS provides no call-log access to any app. No workarounds.
 *  - When implemented: list recent calls locally and create leads ONLY for
 *    entries the user taps. Never upload the call log itself to the server.
 *
 * Until then, users land on Plan A: the "Log a call" quick action and the
 * automatic after-call prompt on a lead's Call button.
 */
export default function RecentCallsScreen() {
  const router = useRouter();
  const flags = useMobileFlags();

  const available = Platform.OS === 'android' && flags.androidCallLogCapture;

  return (
    <Screen>
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
        <Pressable onPress={() => router.back()} hitSlop={8} className="active:opacity-60">
          <BackChevron />
        </Pressable>
        <Text className="text-lg font-bold text-white">Recent calls</Text>
      </View>
      <EmptyState
        title={available ? 'Coming soon' : 'Not available'}
        hint={
          available
            ? 'Call-log capture requires an app update that includes call-log support. Use "Log a call" meanwhile.'
            : 'Call-log capture is not available on this device. Use the "Log a call" quick action instead.'
        }
      />
    </Screen>
  );
}
