import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { fetchNotifications } from '@/api/endpoints/notifications';
import { useBusiness } from '@/business/BusinessContext';
import { BusinessSwitcher } from '@/components/business-switcher';
import { InitialsAvatar } from '@/components/ui';
import { BRAND_GRADIENT, useTheme } from '@/lib/theme';

/**
 * Global screen header used by every top-level tab, on the signature
 * diagonal gradient with white text/icons:
 *   [business logo]  Title            [bell]  [gear]  [More]
 *                    Location ⌄
 * Tapping the location line opens the business switcher; the gear goes to
 * Settings and More opens the More screen (support & account entry points).
 * Labeled "More", not "Help" — it isn't a help center, it's the account/
 * workspace/settings hub (see more.tsx), and calling it "Help" was
 * misleading users into expecting FAQ/support content that doesn't exist.
 */
export function AppHeader({
  title,
  showSettings = true,
}: {
  title: string;
  showSettings?: boolean;
}) {
  const { activeBusiness } = useBusiness();
  const router = useRouter();
  const t = useTheme();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Light polling — this badge just needs to be roughly fresh, not live.
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const unread = notifications.data?.unreadCount ?? 0;

  // "Bidhannagar, Kolkata" line — best-effort from the address.
  const location = activeBusiness?.address
    ? activeBusiness.address.split(',').slice(-2).join(',').trim()
    : (activeBusiness?.category ?? '');

  return (
    <LinearGradient
      colors={[...BRAND_GRADIENT]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      // No `className` — LinearGradient is a third-party native component;
      // NativeWind's layout classes (flex-row here) silently fail to apply
      // to it in this project's setup, leaving it at RN's column default.
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingBottom: 12,
        paddingTop: 8,
        // Gap before whatever content follows the header on every screen —
        // without this, the header's colored background touched the next
        // section directly with no breathing room.
        marginBottom: 14,
      }}
    >
      <InitialsAvatar name={activeBusiness?.name} size={44} colors={['#ffffff33', '#ffffff1a']} />

      <View className="flex-1">
        <Text className="font-display text-xl tracking-tight text-on-brand" numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          onPress={() => setSwitcherOpen(true)}
          // No `className` on Pressable — react-native-css-interop can
          // swallow onPress on styled Pressables (see ui.tsx PrimaryButton).
          style={{ marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
        >
          <Text className="font-sans-semibold text-sm text-on-brand/80" numberOfLines={1}>
            {location || activeBusiness?.name || 'Select business'}
          </Text>
          <Ionicons name="chevron-down" size={14} color="#ffffffcc" />
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push('/notifications')}
        // No `className` — see note above.
        style={{ height: 40, width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999 }}
      >
        <View>
          <Ionicons name="notifications-outline" size={22} color="#ffffff" />
          {unread > 0 && (
            <View className="absolute -right-0.5 -top-0.5 h-4 min-w-4 items-center justify-center rounded-full bg-error px-1">
              <Text className="font-sans-bold text-[9px] text-on-brand">
                {unread > 9 ? '9+' : unread}
              </Text>
            </View>
          )}
        </View>
      </Pressable>

      {showSettings && (
        <Pressable
          onPress={() => router.push('/settings')}
          // No `className` — see note above.
          style={{ height: 40, width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999 }}
        >
          <Ionicons name="settings-outline" size={22} color="#ffffff" />
        </Pressable>
      )}

      <Pressable
        onPress={() => router.push('/more')}
        // No `className` — see note above.
        style={{
          borderRadius: 999,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.4)',
          paddingHorizontal: 16,
          paddingVertical: 8,
        }}
      >
        <Text className="font-sans-bold text-base text-on-brand">More</Text>
      </Pressable>

      {/* Business / location switcher */}
      <Modal
        visible={switcherOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSwitcherOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}
          onPress={() => setSwitcherOpen(false)}
        />
        <View className="max-h-[70%] rounded-t-3xl border-t border-surface-border bg-surface p-5 pb-8">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="font-display-bold text-lg text-white">Your businesses</Text>
            <Pressable
              onPress={() => setSwitcherOpen(false)}
              // No `className` — see note above.
              style={{ height: 36, width: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: t.overlay }}
            >
              <Ionicons name="close" size={18} color={t.textDim} />
            </Pressable>
          </View>
          <ScrollView>
            <BusinessSwitcher />
          </ScrollView>
        </View>
      </Modal>
    </LinearGradient>
  );
}
