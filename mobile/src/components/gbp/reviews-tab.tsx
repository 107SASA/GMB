import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fetchDashboardStats } from '@/api/endpoints/dashboard';
import { fetchReviews, type Review } from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import { WeeklyBars } from '@/components/charts';
import { useLatestAudit } from '@/components/gbp/use-latest-audit';
import { replyStatusBadge, sentimentTone, Stars } from '@/components/review-bits';
import { Badge, Skeleton } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { computeReviewInsights } from '@/lib/review-insights';
import { useTheme } from '@/lib/theme';

type RatingFilter = 'all' | 5 | 4 | 3 | 2 | 1;
const RATING_FILTERS: RatingFilter[] = ['all', 5, 4, 3, 2, 1];

function ReviewRow({ review }: { review: Review }) {
  const router = useRouter();
  const status = replyStatusBadge(review.replyStatus);
  return (
    <Pressable
      onPress={() => router.push(`/reviews/${review._id}`)}
      className="mb-3 rounded-2xl border border-surface-border bg-surface-raised px-4 py-3.5 active:opacity-80"
    >
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-base font-semibold text-white" numberOfLines={1}>
          {review.reviewer}
        </Text>
        <Text className="text-xs text-zinc-500">{timeAgo(review.postedAt ?? review.createdAt)}</Text>
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
        <Text className="mt-2 text-sm text-zinc-400" numberOfLines={2}>
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
  const { audit } = useLatestAudit();

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
  const industryAvg = audit?.auditData?.reviewAnalysis?.industryAverage ?? null;
  // Google's true reviews/week from the website's audit; the synced-doc
  // fallback over-counts after bulk imports (createdAt = sync date).
  const avgPerWeek =
    audit?.auditData?.reviewAnalysis?.reviewsPerWeek ?? insights?.avgPerWeek ?? 0;

  const filtered = useMemo(() => {
    const list = reviews.data ?? [];
    if (rating === 'all') return list;
    return list.filter((r) => Math.round(r.rating) === rating);
  }, [reviews.data, rating]);

  return (
    <View className="px-4">
      <Text className="pt-2 text-lg font-extrabold text-white">Review Trends — last 8 weeks</Text>

      {reviews.isLoading ? (
        <Skeleton className="mt-3 h-64" />
      ) : insights ? (
        <>
          <View className="mt-3 flex-row items-center justify-between rounded-2xl border border-surface-border bg-surface-raised px-4 py-3.5">
            <Text className="text-base text-zinc-300">Your Avg. Reviews</Text>
            <Text className="text-xl font-extrabold text-white">
              {avgPerWeek} <Text className="text-sm font-medium text-zinc-500">/ Week</Text>
            </Text>
          </View>
          <View className="mt-3 rounded-2xl border border-surface-border bg-surface-raised px-4 py-4">
            <WeeklyBars data={insights.weekly} industryAvg={industryAvg} />
          </View>
          <View className="mt-3 flex-row gap-3">
            <View className="flex-1 rounded-2xl border border-surface-border bg-surface-raised px-4 py-4">
              <Text className="text-sm text-zinc-400">Rating</Text>
              <View className="mt-1 flex-row items-center gap-1.5">
                <Text className="text-2xl font-extrabold text-white">
                  {stats.data?.metrics.avgRating ?? insights.avgRating}
                </Text>
                <Ionicons name="star" size={18} color={t.amber} />
              </View>
            </View>
            <View className="flex-1 rounded-2xl border border-surface-border bg-surface-raised px-4 py-4">
              <Text className="text-sm text-zinc-400">Reviews</Text>
              <Text className="mt-1 text-2xl font-extrabold text-white">
                {stats.data?.metrics.totalReviews ?? insights.total}
              </Text>
            </View>
          </View>
        </>
      ) : null}

      {/* Google Reviews + rating filter */}
      <View className="mb-3 mt-7 flex-row items-center justify-between">
        <Text className="text-lg font-extrabold text-white">Google Reviews</Text>
        <Pressable
          onPress={() => setFilterOpen((v) => !v)}
          className="flex-row items-center gap-1.5 rounded-full border px-4 py-2 active:opacity-70"
          style={{ borderColor: t.brandBright }}
        >
          <Text className="text-sm font-bold" style={{ color: t.brandBright }}>
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
              className={`rounded-full border px-4 py-2 ${
                rating === f ? 'border-brand bg-brand' : 'border-surface-border bg-surface-raised'
              }`}
            >
              <Text
                className={`text-sm font-semibold ${rating === f ? 'text-on-brand' : 'text-zinc-400'}`}
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
          <View className="items-center rounded-2xl border border-surface-border bg-surface-raised px-5 py-8">
            <Text className="text-center text-sm text-zinc-400">
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
