import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { useBusiness } from '@/business/BusinessContext';
import { AppHeader } from '@/components/app-header';
import { OverviewTab } from '@/components/gbp/overview-tab';
import { GbpProfileTab } from '@/components/gbp/profile-tab';
import { LockedScreen } from '@/components/locked';
import { Screen } from '@/components/ui';
import { useSurfaceLocked } from '@/entitlements/entitlements';
import { useTheme } from '@/lib/theme';

// Performance / Posts / Reviews / Photos were promoted to their own
// top-level bottom-bar tabs (see (app)/performance, (app)/posts,
// (app)/reviews, (app)/photos) — this hub now only holds what doesn't have
// a tab slot of its own. Reachable from More → "Business Profile", not the
// bottom bar (see more.tsx). Overview's content (AI Impact chart + AI
// Actions feed) is slated to move onto Home directly in the next pass —
// left here for now so nothing regresses mid-restructure.
type GbpTab = 'profile' | 'overview';

const TABS: { id: GbpTab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'overview', label: 'Overview' },
];

/** Business Profile hub — shared header plus Profile/Overview sub-tabs. */
export default function GbpScreen() {
  const [tab, setTab] = useState<GbpTab>('profile');
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const t = useTheme();
  const locked = useSurfaceLocked('dashboard');

  if (locked) return <LockedScreen surface="dashboard" />;

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ predicate: () => true });
    setRefreshing(false);
  };

  return (
    <Screen>
      <AppHeader title="Business Profile" />

      {/* Top tab bar */}
      <View className="border-b border-surface-border">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="px-2"
        >
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            return (
              <Pressable
                key={id}
                onPress={() => setTab(id)}
                // No `className` — react-native-css-interop can swallow
                // onPress on styled Pressables (see components/ui.tsx).
                style={{
                  paddingHorizontal: 16,
                  paddingBottom: 12,
                  paddingTop: 4,
                  borderBottomWidth: 2,
                  borderBottomColor: active ? t.brandBright : 'transparent',
                }}
              >
                <Text
                  className="font-sans-bold text-base"
                  style={{ color: active ? t.brandBright : t.text }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        key={`${tab}-${activeBusinessId}`}
        contentContainerClassName="pb-10 pt-3"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={t.brandBright}
          />
        }
      >
        {tab === 'profile' && <GbpProfileTab />}
        {tab === 'overview' && <OverviewTab />}
      </ScrollView>
    </Screen>
  );
}
