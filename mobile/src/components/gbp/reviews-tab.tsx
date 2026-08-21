import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fetchDashboardStats } from '@/api/endpoints/dashboard';
import { fetchReviews, type Review } from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import { WeeklyBars } from '@/components/charts';
import { replyStatusBadge, sentimentTone, Stars } from '@/components/review-bits';
import { Badge, Skeleton } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { computeReviewInsights } from '@/lib/review-insights';
import { useTheme } from '@/lib/theme';

type RatingFilter = 'all' | 5 | 4 | 3 | 2 | 1;
const RATING_FILTERS: RatingFilter[] = ['all', 5, 4, 3, 2, 1];

function ReviewRow({ review }: { review: Review }) {
  const router = useRouter();
  const t = useTheme();
  const status = replyStatusBadge(review.replyStatus);
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
        <Text className="font-sans text-xs text-zinc-500">{timeAgo(review.postedAt ?? review.createdAt)}</Text>
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
    </Pressable>
  );
}

/**
 * GBP → Reviews: the 8-week trends block (chart + rating/reviews cards)
 * followed by the Google Reviews list with an "All Ratings" filter.
 * Replying to a review continues on the existing review detail screen.
 */
export function ReviewsTab() {
  const { activeBusinessId } = useBusiness();
  const t = useTheme();
  const [rating, setRating] = useState<RatingFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);

  const reviews = useQuery({
    queryKey: ['reviews', activeBusinessId],
    queryFn: fetchReviews,
    enabled: !!activeBusinessId,
  });
  // Same source as the web dashboard's rating/review numbers.
  const stats = useQuery({
    queryKey: ['dashboard-stats', activeBusinessId],
    queryFn: () => fetchDashboardStats(30),
    enabled: !!activeBusinessId,
  });

  const insights = reviews.data ? computeReviewInsights(reviews.data) : null;
  // Deliberately NOT audit?.auditData?.reviewAnalysis?.reviewsPerWeek — see
  // the identical fix in review-trends-section.tsx for the full reasoning:
  // that figure is a lifetime average, a different number from what the 8
  // bars below actually show, which made this screen contradict itself.
  // industryAvg (hardcoded 4.2 for every business) was removed the same way.
  const avgPerWeek = insights?.avgPerWeek ?? 0;

  const filtered = useMemo(() => {
    const list = reviews.data ?? [];
    if (rating === 'all') return list;
    return list.filter((r) => Math.round(r.rating) === rating);
  }, [reviews.data, rating]);

  return (
    <View className="px-4">
      <Text className="pt-2 font-display-bold text-lg text-white">Review Trends — last 8 weeks</Text>

      {reviews.isLoading ? (
        <Skeleton className="mt-3 h-64" />
      ) : insights ? (
        <>
          <View className="mt-3 flex-row items-center justify-between rounded-card border border-surface-border bg-surface-raised px-4 py-3.5">
            <Text className="font-sans text-base text-zinc-300">Your Avg. Reviews</Text>
            <Text className="font-display text-xl text-white">
              {avgPerWeek} <Text className="font-sans-semibold text-sm text-zinc-500">/ Week</Text>
            </Text>
          </View>
          <View className="mt-3 rounded-card border border-surface-border bg-surface-raised px-4 py-4">
            <WeeklyBars data={insights.weekly} />
          </View>
          <View className="mt-3 flex-row gap-3">
            <View className="flex-1 rounded-card border border-surface-border bg-surface-raised px-4 py-4">
              <Text className="font-sans text-sm text-zinc-400">Rating</Text>
              <View className="mt-1 flex-row items-center gap-1.5">
                <Text className="font-display text-2xl text-white">
                  {stats.data?.metrics.avgRating ?? insights.avgRating}
                </Text>
                <Ionicons name="star" size={18} color={t.amber} />
              </View>
            </View>
            <View className="flex-1 rounded-card border border-surface-border bg-surface-raised px-4 py-4">
              <Text className="font-sans text-sm text-zinc-400">Reviews</Text>
              <Text className="mt-1 font-display text-2xl text-white">
                {stats.data?.metrics.totalReviews ?? insights.total}
              </Text>
            </View>
          </View>
        </>
      ) : null}

      {/* Google Reviews + rating filter */}
      <View className="mb-3 mt-7 flex-row items-center justify-between">
        <Text className="font-display-bold text-lg text-white">Google Reviews</Text>
        <Pressable
          onPress={() => setFilterOpen((v) => !v)}
          // No `className` — see note above.
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8, borderColor: t.brandBright }}
        >
          <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
            {rating === 'all' ? 'All Ratings' : `${rating} Stars`}
          </Text>
          <Ionicons name={filterOpen ? 'chevron-up' : 'chevron-down'} size={14} color={t.brandBright} />
        </Pressable>
      </View>

      {filterOpen && (
        <View className="mb-3 flex-row flex-wrap gap-2">
          {RATING_FILTERS.map((f) => (
            <Pressable
              key={String(f)}
              onPress={() => {
                setRating(f);
                setFilterOpen(false);
              }}
              // No `className` — see note above.
              style={{
                borderRadius: 999,
                borderWidth: 1,
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderColor: rating === f ? t.brand : t.border,
                backgroundColor: rating === f ? t.brand : t.card,
              }}
            >
              <Text
                className={`font-sans-semibold text-sm ${rating === f ? 'text-on-brand' : 'text-zinc-400'}`}
              >
                {f === 'all' ? 'All' : `${f} ★`}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <View className="pb-4">
        {reviews.isLoading ? (
          <Skeleton className="h-40" />
        ) : filtered.length === 0 ? (
          <View className="items-center rounded-card border border-surface-border bg-surface-raised px-5 py-8">
            <Text className="text-center font-sans text-sm text-zinc-400">
              {rating === 'all'
                ? 'Reviews synced from your Google Business Profile will appear here.'
                : 'No reviews with this rating.'}
            </Text>
          </View>
        ) : (
          filtered.map((review) => <ReviewRow key={review._id} review={review} />)
        )}
      </View>
    </View>
  );
}
