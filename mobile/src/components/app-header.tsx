import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { fetchNotifications } from '@/api/endpoints/notifications';
import { useBusiness } from '@/business/BusinessContext';
import { BusinessSwitcher } from '@/components/business-switcher';
import { InitialsAvatar } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * Global screen header used by every top-level tab:
 *   [business logo]  Title            [bell]  [gear]  [More]
 *                    Location ⌄
 * Tapping the location line opens the business switcher; the gear goes to
 * Settings and More opens the More screen (support & account entry points).
 * Labeled "More", not "Help" — it isn't a help center, it's the account/
 * workspace/settings hub (see more.tsx), and calling it "Help" was
 * misleading users into expecting FAQ/support content that doesn't exist.
 *
 * Deliberately sits on the plain screen background (t.bg), not the brand
 * gradient — the green diagonal band read as loud/dated next to the rest of
 * the UI (Aug 2026 feedback). Text/icon colors below are theme-aware (t.text
 * etc.), NOT the `on-brand` token (always-white, meant for the brand-colored
 * surfaces this header no longer is) — on a light background that white
 * would go invisible in light mode. Brand green is kept only as small
 * accents (see BRAND_GRADIENT in theme.ts, still used by buttons/login).
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
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingBottom: 12,
        paddingTop: 8,
        backgroundColor: t.bg,
        // Gap before whatever content follows the header on every screen.
        marginBottom: 14,
      }}
    >
      {/* No `colors` override — falls back to InitialsAvatar's own
          BRAND_GRADIENT default, which is the validated white-text-safe
          pairing. A theme-color pairing here would put white initials text
          on a near-white circle in light mode. This also keeps one small
          brand-green accent in the header, matching the "green only as
          small accents" direction. */}
      <InitialsAvatar name={activeBusiness?.name} size={44} imageUrl={activeBusiness?.logoUrl} />

      <View className="flex-1">
        <Text className="font-display text-xl tracking-tight" style={{ color: t.text }} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          onPress={() => setSwitcherOpen(true)}
          // No `className` on Pressable — react-native-css-interop can
          // swallow onPress on styled Pressables (see ui.tsx PrimaryButton).
          style={{ marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
        >
          <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }} numberOfLines={1}>
            {location || activeBusiness?.name || 'Select business'}
          </Text>
          <Ionicons name="chevron-down" size={14} color={t.textFaint} />
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push('/notifications')}
        // No `className` — see note above.
        style={{ height: 40, width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999 }}
      >
        <View>
          <Ionicons name="notifications-outline" size={22} color={t.text} />
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
          <Ionicons name="settings-outline" size={22} color={t.text} />
        </Pressable>
      )}

      <Pressable
        onPress={() => router.push('/more')}
        // No `className` — see note above.
        style={{
          borderRadius: 999,
          borderWidth: 1,
          borderColor: t.border,
          paddingHorizontal: 16,
          paddingVertical: 8,
        }}
      >
        <Text className="font-sans-bold text-base" style={{ color: t.text }}>More</Text>
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
    </View>
  );
}
