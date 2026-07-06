import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { quickAddLead } from '@/api/endpoints/leads';
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
import { useTheme } from '@/lib/theme';

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
  const t = useTheme();
  return (
    <>
      <View className="items-center gap-1.5">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-white/10">
          <Ionicons name={icon} size={22} color="#ffffff" />
        </View>
        <Text className="text-[11px] font-semibold text-white/90">{label}</Text>
      </View>
      {showArrow && <Ionicons name="arrow-forward" size={16} color={t.emerald} />}
    </>
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

  if (reviews.isLoading) return <Skeleton className="mx-4 h-52" />;
  const insights = computeReviewInsights(reviews.data ?? []);
  const goalMet = insights.thisWeek >= WEEKLY_REVIEW_GOAL;
  const pct = Math.min(100, Math.round((insights.thisWeek / WEEKLY_REVIEW_GOAL) * 100));

  return (
    <View
      className="mx-4 rounded-3xl p-4"
      style={{ backgroundColor: goalMet ? '#0B3D2E' : '#4A0D14' }}
    >
      <Text className="text-sm text-white/80">This Week's Reviews</Text>
      <View className="mt-1 flex-row items-center justify-between">
        <Text className="flex-1 pr-3 text-lg font-extrabold text-white">
          {insights.thisWeek === 0
            ? 'No recent reviews received'
            : goalMet
              ? 'Weekly review goal hit!'
              : `${insights.thisWeek} new review${insights.thisWeek > 1 ? 's' : ''} this week`}
        </Text>
        <Text className="text-xl font-extrabold">
          <Text style={{ color: goalMet ? '#34D399' : '#FB7185' }}>{insights.thisWeek}</Text>
          <Text className="text-white/70">/{WEEKLY_REVIEW_GOAL}</Text>
        </Text>
      </View>

      {/* Flame progress bar */}
      <View className="mt-3 flex-row items-center gap-2">
        <View className="h-8 w-8 items-center justify-center rounded-full bg-white/10">
          <Text className="text-sm">🔥</Text>
        </View>
        <View className="h-2 flex-1 overflow-hidden rounded-full bg-white/15">
          <View
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: goalMet ? '#34D399' : '#FB7185' }}
          />
        </View>
      </View>

      {insights.daysSinceLast != null && insights.daysSinceLast > 3 && (
        <Text className="mt-3 text-sm leading-5 text-white/80">
          Your last review was <Text className="font-bold text-rose-400">{insights.daysSinceLast} days</Text>{' '}
          ago, reviews are vital for good Google ranking.
        </Text>
      )}

      <View className="mt-4 flex-row items-center justify-between px-1">
        <FunnelStep icon="people-outline" label="More Customers" showArrow />
        <FunnelStep icon="star-outline" label="More Reviews" showArrow />
        <FunnelStep icon="trending-up-outline" label="Better Ranking" showArrow={false} />
      </View>
    </View>
  );
}

/** Phone input + "Add Customer" — quick-adds a contact to All Contacts. */
function AddCustomerCard() {
  const router = useRouter();
  const t = useTheme();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('');

  const add = useMutation({
    mutationFn: () => quickAddLead({ phone: phone.trim(), source: 'Manual' }),
    onSuccess: (result) => {
      setPhone('');
      void queryClient.invalidateQueries({ queryKey: ['crm-leads'] });
      Alert.alert(
        result.existing ? 'Already added' : 'Customer added',
        result.existing
          ? `${result.lead.name} is already in All Contacts.`
          : 'Saved to All Contacts — ask them for a review!'
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
          className="h-13 w-13 items-center justify-center rounded-2xl border border-surface-border bg-surface-raised active:bg-surface-overlay"
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
      <Text className="mb-3 text-lg font-extrabold text-white">Complete Your Onboarding Tasks</Text>
      <View className="rounded-3xl border border-surface-border bg-surface-raised p-4">
        <View className="flex-row items-center gap-1.5">
          <Text className="text-base font-bold text-white">Upload Photos for GBP</Text>
          <Ionicons name="information-circle-outline" size={15} color={t.textFaint} />
        </View>
        <Text className="mt-1 text-sm leading-5 text-zinc-400" numberOfLines={2}>
          Add photos to the photobucket and they are posted to your Google Business Profile at
          regular intervals.
        </Text>
        <View className="mt-4 flex-row items-end justify-between">
          <Pressable
            onPress={() => router.push('/photos')}
            className="rounded-xl px-4 py-2.5 active:opacity-80"
            style={{ backgroundColor: t.brand }}
          >
            <Text className="text-sm font-bold text-white">Upload Photos</Text>
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

      {/* Orange "fresh photos" nudge pinned above the tab bar */}
      {showFreshPhotosBanner && (
        <Pressable
          onPress={() => router.push('/photos')}
          className="flex-row items-center justify-between px-4 py-3 active:opacity-90"
          style={{ backgroundColor: '#F97316' }}
        >
          <View className="flex-row items-center gap-2">
            <Ionicons name="images-outline" size={18} color="#ffffff" />
            <Text className="text-sm font-bold text-white">It's been {staleDays} days</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Text className="text-sm font-bold text-white">Add Fresh Photos</Text>
            <Ionicons name="chevron-forward" size={16} color="#ffffff" />
          </View>
        </Pressable>
      )}
    </Screen>
  );
}
