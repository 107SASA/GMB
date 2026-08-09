import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, RefreshControl, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchReviews, ReviewsNotConnectedError, syncReviews, type Review } from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import { AppHeader } from '@/components/app-header';
import { ReviewTrendsSection } from '@/components/gbp/review-trends-section';
import { replyStatusBadge, sentimentTone, Stars } from '@/components/review-bits';
import { Badge, Chip, EmptyState, Screen, Skeleton } from '@/components/ui';
import { LockedScreen } from '@/components/locked';
import { useSurfaceLocked } from '@/entitlements/entitlements';
import { promptConnectGoogle } from '@/lib/connectGoogle';
import { useTheme } from '@/lib/theme';
import { timeAgo } from '@/lib/format';

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
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 font-sans-semibold text-base text-white" numberOfLines={1}>
          {review.reviewer}
        </Text>
        <Text className="font-sans text-xs text-zinc-500">
          {timeAgo(review.postedAt ?? review.createdAt)}
        </Text>
      </View>
      <View className="mt-1.5 flex-row items-center gap-2">
        <Stars rating={review.rating} />
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

export default function ReviewsScreen() {
  const locked = useSurfaceLocked('reviews');
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const t = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');

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
      Alert.alert('Sync failed', getApiErrorMessage(error, 'Please try again.'));
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
      <FlatList
        data={filtered}
        keyExtractor={(r) => r._id}
        renderItem={({ item }) => <ReviewCard review={item} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={reviews.isRefetching || sync.isPending}
            onRefresh={() => sync.mutate()}
            tintColor={t.brandBright}
          />
        }
        ListHeaderComponent={
          <>
            <AppHeader title="Reviews" />

            <View className="mb-2">
              <Text className="mb-3 font-display-bold text-lg text-white">Review Trends — last 8 weeks</Text>
              <ReviewTrendsSection />
            </View>

            <View className="mb-3 flex-row items-center justify-between">
              <Text className="font-display-bold text-lg text-white">Google Reviews</Text>
              <View className="flex-row items-center gap-2">
                <Pressable
                  onPress={() => sync.mutate()}
                  disabled={sync.isPending || !activeBusinessId}
                  hitSlop={10}
                  // No `className` — see note above.
                  style={{ height: 36, width: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: t.card }}
                >
                  {sync.isPending ? (
                    <ActivityIndicator size="small" color={t.brandBright} />
                  ) : (
                    <Ionicons name="sync-outline" size={17} color={t.brandBright} />
                  )}
                </Pressable>
                <RatingFilterPicker value={ratingFilter} onChange={setRatingFilter} />
              </View>
            </View>

            <View className="mb-3">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
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
    </Screen>
  );
}
