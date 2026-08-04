import { Ionicons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Slim app-wide strip shown whenever the device has no connection. Queries
 * still resolve from the persisted cache (see PersistQueryClientProvider in
 * _layout.tsx), so screens keep showing the last-known data — this just
 * makes it clear that data on screen may be stale rather than live.
 *
 * Floats as an overlay pinned to the safe-area top edge (absolute, not laid
 * out in flow) — every screen already reserves its own top inset via
 * <Screen>'s SafeAreaView, so adding this to normal layout flow would push
 * that padding down and double it. Overlaying instead means it never fights
 * with per-screen layout, at the cost of covering a sliver of content while
 * shown, which is an acceptable trade for a rare, short-lived state.
 */
export function OfflineBanner() {
  const { isConnected } = useNetInfo();
  const insets = useSafeAreaInsets();

  // isConnected is null while NetInfo is still determining state on cold
  // start — treat that as "assume online" rather than flashing the banner.
  if (isConnected !== false) return null;

  return (
    <View
      pointerEvents="none"
      className="absolute left-0 right-0 z-50 flex-row items-center justify-center gap-1.5 py-1.5"
      style={{ top: insets.top, backgroundColor: '#ffb300f2' }}
    >
      <Ionicons name="cloud-offline-outline" size={13} color="#1c1400" />
      <Text className="font-sans-semibold text-xs text-[#1c1400]">
        You're offline — showing saved data
      </Text>
    </View>
  );
}
