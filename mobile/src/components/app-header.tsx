import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { useBusiness } from '@/business/BusinessContext';
import { BusinessSwitcher } from '@/components/business-switcher';
import { InitialsAvatar } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * Grexa-style screen header used by every top-level tab:
 *   [business logo]  Title            [gear]  [Help]
 *                    Location ⌄
 * Tapping the location line opens the business switcher; the gear goes to
 * Settings and Help opens the More screen (support & account entry points).
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

  // "Bidhannagar, Kolkata" line — best-effort from the address.
  const location = activeBusiness?.address
    ? activeBusiness.address.split(',').slice(-2).join(',').trim()
    : (activeBusiness?.category ?? '');

  return (
    <View className="flex-row items-center gap-3 px-4 pb-3 pt-2">
      <InitialsAvatar name={activeBusiness?.name} size={44} />

      <View className="flex-1">
        <Text className="text-xl font-extrabold tracking-tight text-white" numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          onPress={() => setSwitcherOpen(true)}
          className="mt-0.5 flex-row items-center gap-1 self-start active:opacity-70"
        >
          <Text className="text-sm font-semibold" style={{ color: t.brandBright }} numberOfLines={1}>
            {location || activeBusiness?.name || 'Select business'}
          </Text>
          <Ionicons name="chevron-down" size={14} color={t.brandBright} />
        </Pressable>
      </View>

      {showSettings && (
        <Pressable
          onPress={() => router.push('/settings')}
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-overlay"
        >
          <Ionicons name="settings-outline" size={22} color={t.textDim} />
        </Pressable>
      )}

      <Pressable
        onPress={() => router.push('/more')}
        className="rounded-xl border px-4 py-2 active:opacity-70"
        style={{ borderColor: t.brandBright }}
      >
        <Text className="text-base font-bold" style={{ color: t.brandBright }}>
          Help
        </Text>
      </Pressable>

      {/* Business / location switcher */}
      <Modal
        visible={switcherOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSwitcherOpen(false)}
      >
        <Pressable className="flex-1 bg-black/60" onPress={() => setSwitcherOpen(false)} />
        <View className="max-h-[70%] rounded-t-3xl border-t border-surface-border bg-surface p-5 pb-8">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-white">Your businesses</Text>
            <Pressable
              onPress={() => setSwitcherOpen(false)}
              className="h-9 w-9 items-center justify-center rounded-full bg-surface-overlay"
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
