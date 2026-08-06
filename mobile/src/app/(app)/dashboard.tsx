import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { getApiErrorMessage } from '@/api/client';
import { quickAddCustomer } from '@/api/endpoints/customers';
import { fetchReviews } from '@/api/endpoints/reviews';
import { fetchBuffer } from '@/api/endpoints/scheduler';
import { useAuth } from '@/auth/AuthContext';
import { useBusiness } from '@/business/BusinessContext';
import { AppHeader } from '@/components/app-header';
import { AiActionsCard } from '@/components/gbp/ai-actions';
import { BillingBanner, LockedScreen } from '@/components/locked';
import { Field, PrimaryButton, Screen, Skeleton } from '@/components/ui';
import { useSurfaceLocked } from '@/entitlements/entitlements';
import { computeReviewInsights, WEEKLY_REVIEW_GOAL } from '@/lib/review-insights';
import { AMBER_GRADIENT, useTheme } from '@/lib/theme';

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
  // Deep tonal container so white body copy stays legible everywhere on the
  // card — the diagonal gradients are reserved for headers/CTAs and would
  // wash out against this much running text.
  const cardBg = goalMet ? '#005233' : '#93000a';
  const accent = goalMet ? '#9af2c0' : '#ffdad6';

  return (
    <View className="mx-4 rounded-card p-4" style={{ backgroundColor: cardBg }}>
      {/* Every text/overlay color in this card is a fixed literal (never the
          theme-relative text-white/bg-white classes) because cardBg above is
          a hardcoded hex, not a theme token — text-white resolves to
          near-black in light mode, which was invisible against this fixed
          dark card. */}
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
    </View>
  );
}

/**
 * Phone input + "Add Customer" — the intended flow: enter a customer's
 * number, the app immediately sends them a WhatsApp review request (same
 * one-off send the "Send Review Request" button on the website's Customers
 * page uses, via POST /api/customers/quick-add → the processReviewCampaign
 * Inngest job). This used to call the CRM lead endpoint instead, which only
 * filed a sales-pipeline contact and queued a generic 24h-later "thanks for
 * your interest" WhatsApp drip — no review request was ever sent.
 */
function AddCustomerCard() {
  const router = useRouter();
  const t = useTheme();
  const [phone, setPhone] = useState('');

  const add = useMutation({
    mutationFn: () => quickAddCustomer({ phone: phone.trim() }),
    onSuccess: (result) => {
      setPhone('');
      if (!result.reviewRequestSent) {
        Alert.alert('Customer saved', result.reason ?? 'No review request was sent.');
        return;
      }
      Alert.alert(
        'Review request sent',
        result.existing
          ? `${result.customer.name} was already a customer — sent them another WhatsApp review request.`
          : `We've texted ${result.customer.name} on WhatsApp asking for a Google review.`
      );
    },
    onError: (error) =>
      Alert.alert('Could not add customer', getApiErrorMessage(error, 'Please try again.')),
  });

  return (
    <View className="mx-4 mt-4">
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field
            value={phone}
            onChangeText={setPhone}
            placeholder="Customer Phone Number"
            keyboardType="phone-pad"
          />
        </View>
        <Pressable
          onPress={() => router.push('/leads/import-contacts')}
          // No `className` — see app-header.tsx note.
          style={{
            height: 52,
            width: 52,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.card,
          }}
        >
          <Ionicons name="people-outline" size={22} color={t.brandBright} />
        </Pressable>
      </View>
      <View className="mt-3">
        <PrimaryButton
          title="Add Customer"
          onPress={() => add.mutate()}
          loading={add.isPending}
          disabled={phone.trim().length < 7}
        />
      </View>
    </View>
  );
}

/** "Complete Your Onboarding Tasks" — upload-photos task card. */
function OnboardingTasks() {
  const router = useRouter();
  const t = useTheme();
  return (
    <View className="mx-4 mt-8">
      <Text className="mb-3 font-display-bold text-lg text-white">
        Complete Your Onboarding Tasks
      </Text>
      <View className="rounded-card border border-surface-border bg-surface-raised p-4">
        <View className="flex-row items-center gap-1.5">
          <Text className="font-sans-bold text-base text-white">Upload Photos for GBP</Text>
          <Ionicons name="information-circle-outline" size={15} color={t.textFaint} />
        </View>
        <Text className="mt-1 font-sans text-sm leading-5 text-zinc-400" numberOfLines={2}>
          Add photos to the photobucket and they are posted to your Google Business Profile at
          regular intervals.
        </Text>
        <View className="mt-4 flex-row items-end justify-between">
          <Pressable
            onPress={() => router.push('/photos')}
            // No `className` — see app-header.tsx note.
            style={{ borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: t.brand }}
          >
            <Text className="font-sans-bold text-sm text-on-brand">Upload Photos</Text>
          </Pressable>
          <Ionicons name="storefront" size={34} color={t.brandBright} />
        </View>
      </View>
    </View>
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
        <AppHeader title={activeBusiness?.name ?? 'Home'} />
        <BillingBanner />

        <WeeklyReviewsCard />
        <AddCustomerCard />
        <OnboardingTasks />

        <View className="mx-4">
          <AiActionsCard />
        </View>
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
