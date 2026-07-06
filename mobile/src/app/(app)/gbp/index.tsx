import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { useBusiness } from '@/business/BusinessContext';
import { AppHeader } from '@/components/app-header';
import { BusinessAssets } from '@/components/business-assets';
import { OverviewTab } from '@/components/gbp/overview-tab';
import { PerformanceTab } from '@/components/gbp/performance-tab';
import { PostsTab } from '@/components/gbp/posts-tab';
import { ReviewsTab } from '@/components/gbp/reviews-tab';
import { LockedScreen } from '@/components/locked';
import { Screen } from '@/components/ui';
import { useSurfaceLocked } from '@/entitlements/entitlements';
import { useTheme } from '@/lib/theme';

type GbpTab = 'overview' | 'performance' | 'posts' | 'reviews' | 'photos';

const TABS: { id: GbpTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'performance', label: 'Performance' },
  { id: 'posts', label: 'Posts' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'photos', label: 'Photos' },
];

/**
 * Google Business Profile hub — reference-app layout: shared header plus a
 * scrollable top tab bar (Overview / Performance / Posts / Reviews / Photos).
 */
export default function GbpScreen() {
  const [tab, setTab] = useState<GbpTab>('overview');
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
      <AppHeader title="Google Business Profile" />

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
                className="px-4 pb-3 pt-1 active:opacity-70"
                style={{
                  borderBottomWidth: 2,
                  borderBottomColor: active ? t.brandBright : 'transparent',
                }}
              >
                <Text
                  className="text-base font-semibold"
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
        {tab === 'overview' && <OverviewTab />}
        {tab === 'performance' && <PerformanceTab />}
        {tab === 'posts' && <PostsTab />}
        {tab === 'reviews' && <ReviewsTab />}
        {tab === 'photos' && <BusinessAssets />}
      </ScrollView>
    </Screen>
  );
}
