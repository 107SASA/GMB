import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, RefreshControl, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchReviews, ReviewsNotConnectedError, syncReviews, type Review } from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import { AppHeader } from '@/components/app-header';
import { AddCustomerCard } from '@/components/home/add-customer-card';
import { ReviewStatCards, ReviewTrendsChart } from '@/components/gbp/review-trends-section';
import { GoogleG } from '@/components/google-g';
import { replyStatusBadge, RatingPill, sentimentTone } from '@/components/review-bits';
import { Badge, Chip, EmptyState, InitialsAvatar, Screen, SegmentedControl, Skeleton, useInfoSheet } from '@/components/ui';
import { LockedScreen } from '@/components/locked';
import { useSurfaceLocked } from '@/entitlements/entitlements';
import { promptConnectGoogle } from '@/lib/connectGoogle';
import { useTheme } from '@/lib/theme';
import { timeAgo } from '@/lib/format';
import { computeRatingDistribution } from '@/lib/review-insights';

type ScreenTab = 'overview' | 'all';
type Filter = 'all' | 'needs-reply' | 'replied';
type RatingFilter = 'all' | 5 | 4 | 3 | 2 | 1;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'needs-reply', label: 'Needs reply' },
  { id: 'replied', label: 'Replied' },
];
const RATING_FILTERS: { id: RatingFilter; label: string }[] = [
  { id: 'all', label: 'All Ratings' },
  { id: 5, label: '5 stars' },
  { id: 4, label: '4 stars' },
  { id: 3, label: '3 stars' },
  { id: 2, label: '2 stars' },
  { id: 1, label: '1 star' },
];

/** "All Ratings ⌄" bottom-sheet picker. */
function RatingFilterPicker({
  value,
  onChange,
}: {
  value: RatingFilter;
  onChange: (v: RatingFilter) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const current = RATING_FILTERS.find((f) => f.id === value)!;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        // No `className` — react-native-css-interop can swallow onPress on
        // styled Pressables (see components/ui.tsx).
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: t.brandBright,
          paddingHorizontal: 14,
          paddingVertical: 8,
        }}
      >
        <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
          {current.label}
        </Text>
        <Ionicons name="chevron-down" size={14} color={t.brandBright} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setOpen(false)} />
        <View className="rounded-t-3xl border-t border-surface-border bg-surface px-5 pb-8 pt-3">
          <View className="mb-2 self-center h-1 w-10 rounded-full bg-surface-overlay" />
          {RATING_FILTERS.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => {
                onChange(f.id);
                setOpen(false);
              }}
              // No `className` — see note above.
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 }}
            >
              <Text className="font-sans-semibold text-base text-white">{f.label}</Text>
              {value === f.id && <Ionicons name="checkmark" size={18} color={t.brandBright} />}
            </Pressable>
          ))}
        </View>
      </Modal>
    </>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const router = useRouter();
  const t = useTheme();
  const status = replyStatusBadge(review.replyStatus);
  const [replyOpen, setReplyOpen] = useState(false);
  // Honest label, matching the detail screen's own convention (reviews/[id].tsx
  // shows a posted reply as "Your reply", never "AI's reply" — every reply
  // is human-approved before it goes live, even when AI drafted the starting
  // point, so attributing the final posted text to "AI" would overstate what
  // actually happened. See logProfileActivity.ts for the same discipline
  // applied elsewhere in this app.
  const hasReply = review.replyStatus === 'POSTED' && !!review.response;

  return (
    <Pressable
      onPress={() => router.push(`/reviews/${review._id}`)}
      // No `className` — react-native-css-interop can swallow onPress on
      // styled Pressables (see components/ui.tsx).
      style={{
        marginBottom: 12,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.card,
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      <View className="flex-row items-center gap-2.5">
        <InitialsAvatar name={review.reviewer} size={32} imageUrl={review.reviewerPhotoUrl} />
        <Text className="flex-1 font-sans-semibold text-base text-white" numberOfLines={1}>
          {review.reviewer}
        </Text>
        <Text className="font-sans text-xs text-zinc-500">
          {timeAgo(review.postedAt ?? review.createdAt)}
        </Text>
      </View>
      <View className="mt-2.5 flex-row items-center gap-2">
        <RatingPill rating={review.rating} />
        {!!review.sentiment && (
          <Badge label={review.sentiment} tone={sentimentTone(review.sentiment)} />
        )}
        <View className="ml-auto">
          <Badge label={status.label} tone={status.tone} />
        </View>
      </View>
      {!!review.reviewText && (
        <Text className="mt-2 font-sans text-sm text-zinc-400" numberOfLines={2}>
          {review.reviewText}
        </Text>
      )}
      {hasReply && (
        <>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              setReplyOpen((v) => !v);
            }}
            hitSlop={8}
            // No `className` — see note above.
            style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
              Your reply
            </Text>
            <Ionicons name={replyOpen ? 'chevron-up' : 'chevron-down'} size={14} color={t.brandBright} />
          </Pressable>
          {replyOpen && (
            <View className="mt-2 rounded-xl border border-secondary/20 bg-secondary-container/40 px-3.5 py-3">
              <Text className="font-sans text-sm leading-5 text-zinc-200">{review.response}</Text>
            </View>
          )}
        </>
      )}
    </Pressable>
  );
}

/**
 * 5★→1★ counts as proportional bars — real data computed client-side from
 * the same /api/reviews list everything else on this screen already uses,
 * not a new backend field.
 */
function RatingDistribution({ reviews }: { reviews: Review[] }) {
  const t = useTheme();
  const counts = computeRatingDistribution(reviews);
  const max = Math.max(...counts.map((c) => c.count), 1);

  return (
    <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-4">
      {counts.map(({ star, count }) => (
        <View key={star} className="mb-2.5 flex-row items-center gap-2.5 last:mb-0">
          <View className="w-8 flex-row items-center gap-0.5">
            <Text className="font-sans-bold text-xs text-zinc-400">{star}</Text>
            <Ionicons name="star" size={11} color={t.amber} />
          </View>
          <View className="h-2 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: t.overlay }}>
            <View
              style={{
                width: `${(count / max) * 100}%`,
                height: '100%',
                backgroundColor: t.amber,
                borderRadius: 999,
              }}
            />
          </View>
          <Text className="w-6 text-right font-sans text-xs text-zinc-500">{count}</Text>
        </View>
      ))}
    </View>
  );
}

/** "Add more customers to increase potential reviews" — reuses the same WhatsApp-review-request flow the Home tab's AddCustomerCard already ships. */
function AddCustomerBanner() {
  return (
    <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-4">
      <View className="mb-3 flex-row items-center gap-2">
        <GoogleG size={16} />
        <Text className="flex-1 font-sans text-sm text-zinc-300">
          Add more customers to increase potential reviews
        </Text>
      </View>
      <AddCustomerCard />
    </View>
  );
}

/** Overview tab — stat cards, Add Customer, trends chart, rating distribution. */
function OverviewTab({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  const t = useTheme();
  const { activeBusinessId } = useBusiness();
  const reviews = useQuery({
    queryKey: ['reviews', activeBusinessId],
    queryFn: fetchReviews,
    enabled: !!activeBusinessId,
  });

  return (
    <ScrollView
      contentContainerClassName="px-5 pb-10 pt-4"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.brandBright} />}
    >
      <ReviewStatCards />

      <View className="mt-4">
        <AddCustomerBanner />
      </View>

      <Text className="mb-3 mt-6 font-display-bold text-lg text-white">Review Trends — last 8 weeks</Text>
      <ReviewTrendsChart />

      <View className="mb-2 mt-6 flex-row items-center gap-1.5">
        <Text className="font-display-bold text-lg text-white">Rating Distribution</Text>
        <Ionicons name="information-circle-outline" size={16} color={t.textFaint} />
      </View>
      {reviews.isLoading ? (
        <Skeleton className="h-40 rounded-card" />
      ) : (
        <RatingDistribution reviews={reviews.data ?? []} />
      )}
    </ScrollView>
  );
}

/** All Reviews tab — the full filterable list, same as before minus the trends section (moved to Overview). */
function AllReviewsTab({
  reviews,
  filtered,
  filter,
  setFilter,
  ratingFilter,
  setRatingFilter,
  onSync,
  syncing,
}: {
  reviews: ReturnType<typeof useQuery<Review[]>>;
  filtered: Review[];
  filter: Filter;
  setFilter: (f: Filter) => void;
  ratingFilter: RatingFilter;
  setRatingFilter: (f: RatingFilter) => void;
  onSync: () => void;
  syncing: boolean;
}) {
  const t = useTheme();
  return (
    <FlatList
      data={filtered}
      keyExtractor={(r) => r._id}
      renderItem={({ item }) => <ReviewCard review={item} />}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, flexGrow: 1 }}
      refreshControl={
        <RefreshControl refreshing={reviews.isRefetching || syncing} onRefresh={onSync} tintColor={t.brandBright} />
      }
      ListHeaderComponent={
        <>
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="font-display-bold text-lg text-white">Google Reviews</Text>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={onSync}
                disabled={syncing}
                hitSlop={10}
                // No `className` — see note above.
                style={{ height: 36, width: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: t.card }}
              >
                {syncing ? (
                  <ActivityIndicator size="small" color={t.brandBright} />
                ) : (
                  <Ionicons name="sync-outline" size={17} color={t.brandBright} />
                )}
              </Pressable>
              <RatingFilterPicker value={ratingFilter} onChange={setRatingFilter} />
            </View>
          </View>

          <View className="mb-3">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerClassName="gap-2">
              {FILTERS.map((f) => (
                <Chip key={f.id} label={f.label} selected={filter === f.id} onPress={() => setFilter(f.id)} />
              ))}
            </ScrollView>
          </View>

          {reviews.isLoading && (
            <View className="gap-3">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </View>
          )}
          {reviews.isError && (
            <EmptyState title="Couldn't load reviews" hint={getApiErrorMessage(reviews.error, 'Pull down to retry.')} />
          )}
        </>
      }
      ListEmptyComponent={
        reviews.isLoading || reviews.isError ? null : (
          <EmptyState
            title={filter === 'all' && ratingFilter === 'all' ? 'No reviews yet' : 'Nothing here'}
            hint={
              filter === 'all' && ratingFilter === 'all'
                ? 'Pull down or tap the sync icon to pull reviews from your Google Business Profile.'
                : 'Try a different filter.'
            }
          />
        )
      }
    />
  );
}

export default function ReviewsScreen() {
  const locked = useSurfaceLocked('reviews');
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ScreenTab>('overview');
  const [filter, setFilter] = useState<Filter>('all');
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const info = useInfoSheet();

  const reviews = useQuery({
    queryKey: ['reviews', activeBusinessId],
    queryFn: fetchReviews,
    enabled: !!activeBusinessId,
  });

  const sync = useMutation({
    mutationFn: syncReviews,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reviews', activeBusinessId] });
    },
    onError: (error) => {
      if (error instanceof ReviewsNotConnectedError) {
        promptConnectGoogle(error.message);
        return;
      }
      info.show('Sync failed', getApiErrorMessage(error, 'Please try again.'));
    },
  });

  // Same semantics as the web dashboard: replied = POSTED, everything else
  // still needs attention.
  const filtered = useMemo(() => {
    return (reviews.data ?? []).filter((r) => {
      if (ratingFilter !== 'all' && r.rating !== ratingFilter) return false;
      if (filter === 'needs-reply') return r.replyStatus !== 'POSTED';
      if (filter === 'replied') return r.replyStatus === 'POSTED';
      return true;
    });
  }, [reviews.data, filter, ratingFilter]);

  // After all hooks (rules-of-hooks) — matches the dashboard/GBP-hub pattern.
  if (locked) return <LockedScreen surface="reviews" />;

  return (
    <Screen>
      <AppHeader title="Reviews" />
      <SegmentedControl
        segments={[
          { id: 'overview', label: 'Overview' },
          { id: 'all', label: 'All Reviews' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'overview' ? (
        <OverviewTab onRefresh={() => sync.mutate()} refreshing={reviews.isRefetching || sync.isPending} />
      ) : (
        <AllReviewsTab
          reviews={reviews}
          filtered={filtered}
          filter={filter}
          setFilter={setFilter}
          ratingFilter={ratingFilter}
          setRatingFilter={setRatingFilter}
          onSync={() => sync.mutate()}
          syncing={sync.isPending}
        />
      )}
      {info.node}
    </Screen>
  );
}
