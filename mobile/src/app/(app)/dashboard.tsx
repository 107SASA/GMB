import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { fetchReviews } from '@/api/endpoints/reviews';
import { fetchBuffer } from '@/api/endpoints/scheduler';
import { useAuth } from '@/auth/AuthContext';
import { useBusiness } from '@/business/BusinessContext';
import { AppHeader } from '@/components/app-header';
import { AiActionsCard } from '@/components/gbp/ai-actions';
import { AddCustomerCard } from '@/components/home/add-customer-card';
import { AiAgentCard } from '@/components/home/ai-agent-card';
import { BrandingFooter } from '@/components/home/branding-footer';
import { ImpactCard } from '@/components/home/impact-card';
import { HomeStatList } from '@/components/home/stat-list';
import { BillingBanner, LockedScreen } from '@/components/locked';
import { Screen, Skeleton } from '@/components/ui';
import { useSurfaceLocked } from '@/entitlements/entitlements';
import { computeReviewInsights, WEEKLY_REVIEW_GOAL } from '@/lib/review-insights';
import { AMBER_GRADIENT, CRITICAL_GRADIENT, GOAL_MET_CARD_GRADIENT, useTheme } from '@/lib/theme';

/** One step of the "More Customers → More Reviews → Better Ranking" strip. */
function FunnelStep({
  icon,
  label,
  showArrow,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  showArrow: boolean;
}) {
  return (
    // flex-1 on the whole step (not just the label) so all three steps share
    // the row equally and shrink together on narrow screens instead of the
    // last one ("Better Ranking") getting pushed past the card edge.
    <View className="flex-1 flex-row items-start">
      <View className="flex-1 items-center gap-1.5">
        <View
          className="h-12 w-12 items-center justify-center rounded-full"
          style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
        >
          <Ionicons name={icon} size={22} color="#ffffff" />
        </View>
        <Text
          className="w-full text-center font-sans-bold text-[11px] uppercase tracking-[0.6px]"
          style={{ color: 'rgba(255,255,255,0.9)' }}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {label}
        </Text>
      </View>
      {/* Fixed light green, not theme-relative — this card's background is a
          hardcoded color (see cardBg below), so its "arrow" accent must stay
          fixed-light regardless of the phone's light/dark setting too.
          marginTop centers it on the icon circle rather than the full
          (now two-line-capable) label block below it. */}
      {showArrow && <Ionicons name="arrow-forward" size={16} color="#9af2c0" style={{ marginTop: 14 }} />}
    </View>
  );
}

/** The red "This Week's Reviews" goal card. */
function WeeklyReviewsCard() {
  const { activeBusinessId } = useBusiness();
  const reviews = useQuery({
    queryKey: ['reviews', activeBusinessId],
    queryFn: fetchReviews,
    enabled: !!activeBusinessId,
  });

  if (reviews.isLoading) return <Skeleton className="mx-4 h-52 rounded-card" />;
  const insights = computeReviewInsights(reviews.data ?? []);
  const goalMet = insights.thisWeek >= WEEKLY_REVIEW_GOAL;
  const pct = Math.min(100, Math.round((insights.thisWeek / WEEKLY_REVIEW_GOAL) * 100));
  // Both gradients stay dark-to-moderately-dark end to end (never a light/
  // pastel stop) specifically so the white body copy below stays legible
  // everywhere on the card, not just at one end of it.
  const gradient = goalMet ? GOAL_MET_CARD_GRADIENT : CRITICAL_GRADIENT;
  const accent = goalMet ? '#9af2c0' : '#ffdad6';

  return (
    <LinearGradient
      colors={[...gradient]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      // No `className` — LinearGradient is a third-party native component;
      // NativeWind's layout classes silently fail to apply to it (see
      // app-header.tsx). rounded-card's radius value (see tailwind config)
      // ported over as a literal borderRadius for the same reason.
      style={{ marginHorizontal: 16, borderRadius: 20, padding: 16 }}
    >
      {/* Every text/overlay color in this card is a fixed literal (never the
          theme-relative text-white/bg-white classes) because the gradient
          above is a fixed pair of hex values, not a theme token —
          text-white resolves to near-black in light mode, which would be
          invisible against this always-dark card. */}
      <Text className="font-sans text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
        This Week's Reviews
      </Text>
      <View className="mt-1 flex-row items-center justify-between">
        <Text className="flex-1 pr-3 font-display-bold text-lg" style={{ color: '#ffffff' }}>
          {insights.thisWeek === 0
            ? 'No recent reviews received'
            : goalMet
              ? 'Weekly review goal hit!'
              : `${insights.thisWeek} new review${insights.thisWeek > 1 ? 's' : ''} this week`}
        </Text>
        <Text className="font-display text-xl">
          <Text style={{ color: accent }}>{insights.thisWeek}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.7)' }}>/{WEEKLY_REVIEW_GOAL}</Text>
        </Text>
      </View>

      {/* Flame progress bar */}
      <View className="mt-3 flex-row items-center gap-2">
        <View
          className="h-8 w-8 items-center justify-center rounded-full"
          style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
        >
          <Text className="text-sm">🔥</Text>
        </View>
        <View
          className="h-2 flex-1 overflow-hidden rounded-full"
          style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
        >
          <View className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: accent }} />
        </View>
      </View>

      {insights.daysSinceLast != null && insights.daysSinceLast > 3 && (
        <Text className="mt-3 font-sans text-sm leading-5" style={{ color: 'rgba(255,255,255,0.8)' }}>
          Your last review was{' '}
          <Text className="font-sans-bold" style={{ color: accent }}>
            {insights.daysSinceLast} days
          </Text>{' '}
          ago, reviews are vital for good Google ranking.
        </Text>
      )}

      {/* Each FunnelStep is flex-1 (see above), so the three steps always
          split the row's width evenly and the label text wraps/shrinks to
          fit its own column — no more relying on asymmetric edge padding to
          keep "Better Ranking" from running past the card boundary. */}
      <View className="mt-4 flex-row items-start">
        <FunnelStep icon="people-outline" label="More Customers" showArrow />
        <FunnelStep icon="star-outline" label="More Reviews" showArrow />
        <FunnelStep icon="trending-up-outline" label="Better Ranking" showArrow={false} />
      </View>
    </LinearGradient>
  );
}

export default function HomeScreen() {
  const { refreshUser } = useAuth();
  const { activeBusiness, activeBusinessId } = useBusiness();
  const router = useRouter();
  const t = useTheme();
  const queryClient = useQueryClient();
  const locked = useSurfaceLocked('dashboard');
  const [refreshing, setRefreshing] = useState(false);

  // Days since the last published post → the "Add Fresh Photos" banner.
  const buffer = useQuery({
    queryKey: ['scheduler-buffer', activeBusinessId],
    queryFn: fetchBuffer,
    enabled: !!activeBusinessId && !locked,
  });
  const lastPublishedAt = (buffer.data?.allPosts ?? [])
    .filter((p) => p.status === 'published' && (p.publishedAt || p.createdAt))
    .map((p) => new Date(p.publishedAt ?? p.createdAt!).getTime())
    .reduce((acc, ts) => Math.max(acc, ts), 0);
  const staleDays = lastPublishedAt
    ? Math.floor((Date.now() - lastPublishedAt) / (24 * 60 * 60 * 1000))
    : null;
  const showFreshPhotosBanner = staleDays != null && staleDays >= 7;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    void refreshUser().catch(() => {});
    await queryClient.invalidateQueries({ predicate: () => true });
    setRefreshing(false);
  }, [refreshUser, queryClient]);

  if (locked) return <LockedScreen surface="dashboard" />;

  return (
    <Screen>
      {/* Rendered above the ScrollView (not as its first child) so it stays
          pinned in place while everything below scrolls underneath it. */}
      <AppHeader title={activeBusiness?.name ?? 'Home'} />
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-6"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={t.brandBright}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        <BillingBanner />

        <WeeklyReviewsCard />
        <View className="mx-4 mt-4">
          <AddCustomerCard />
        </View>
        <AiAgentCard />

        <HomeStatList />
        <ImpactCard />

        <View className="mx-4">
          <AiActionsCard />
        </View>

        <BrandingFooter />
      </ScrollView>

      {/* Amber "attention needed" nudge pinned above the tab bar */}
      {showFreshPhotosBanner && (
        <Pressable onPress={() => router.push('/photos')}>
          <LinearGradient
            colors={[...AMBER_GRADIENT]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            // No `className` on Pressable (swallows onPress) or LinearGradient
            // (layout classes silently fail on it) — see app-header.tsx.
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingVertical: 12,
            }}
          >
            <View className="flex-row items-center gap-2">
              <Ionicons name="images-outline" size={18} color="#1c1400" />
              <Text className="font-sans-bold text-sm text-[#1c1400]">
                It's been {staleDays} days
              </Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Text className="font-sans-bold text-sm text-[#1c1400]">Add Fresh Photos</Text>
              <Ionicons name="chevron-forward" size={16} color="#1c1400" />
            </View>
          </LinearGradient>
        </Pressable>
      )}
    </Screen>
  );
}
