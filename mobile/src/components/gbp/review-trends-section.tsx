import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { fetchDashboardStats } from '@/api/endpoints/dashboard';
import { fetchReviews } from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import { WeeklyBars } from '@/components/charts';
import { Skeleton } from '@/components/ui';
import { computeReviewInsights } from '@/lib/review-insights';
import { useTheme } from '@/lib/theme';

/**
 * Rating / Reviews stat cards, each with a real change badge (see
 * review-insights.ts). Split out from ReviewTrendsSection (Aug 2026) — the
 * Performance tab wants these AFTER the trends chart (matches its own
 * reference screenshot), but the Reviews tab's Overview wants them BEFORE
 * the chart (matches its reference screenshot), so the two pieces needed to
 * be independently composable rather than always bundled in one order.
 * Self-contained (own React Query fetches, cache-shared by key) — cheap to
 * drop into more than one screen.
 */
export function ReviewStatCards() {
  const { activeBusinessId } = useBusiness();
  const t = useTheme();

  const reviews = useQuery({
    queryKey: ['reviews', activeBusinessId],
    queryFn: fetchReviews,
    enabled: !!activeBusinessId,
  });
  const stats = useQuery({
    queryKey: ['dashboard-stats', activeBusinessId],
    queryFn: () => fetchDashboardStats(30),
    enabled: !!activeBusinessId,
  });

  const insights = reviews.data ? computeReviewInsights(reviews.data) : null;

  if (reviews.isLoading) return <Skeleton className="h-24 rounded-card" />;
  if (!insights) return null;

  return (
    <View className="flex-row gap-3">
      <View className="flex-1 rounded-card border border-surface-border bg-surface-raised px-4 py-4">
        <Text className="font-sans text-sm text-zinc-400">Rating</Text>
        <View className="mt-1 flex-row items-center gap-1.5">
          <Text className="font-display text-2xl text-white">
            {stats.data?.metrics.avgRating ?? insights.avgRating}
          </Text>
          <Ionicons name="star" size={18} color={t.amber} />
        </View>
        {insights.ratingChange != null && (
          <View
            className="mt-1.5 flex-row items-center gap-1 self-start rounded-full px-2.5 py-1"
            style={{
              backgroundColor:
                Math.abs(insights.ratingChange) < 0.05 ? t.overlay : insights.ratingChange > 0 ? `${t.emerald}26` : `${t.rose}26`,
            }}
          >
            {Math.abs(insights.ratingChange) >= 0.05 && (
              <Ionicons
                name={insights.ratingChange > 0 ? 'caret-up' : 'caret-down'}
                size={11}
                color={insights.ratingChange > 0 ? t.emerald : t.rose}
              />
            )}
            <Text
              className="font-sans-bold text-xs"
              style={{
                color:
                  Math.abs(insights.ratingChange) < 0.05
                    ? t.textFaint
                    : insights.ratingChange > 0
                      ? t.emerald
                      : t.rose,
              }}
            >
              {Math.abs(insights.ratingChange) < 0.05
                ? '~ No change'
                : `${insights.ratingChange > 0 ? '+' : ''}${insights.ratingChange} last 8w`}
            </Text>
          </View>
        )}
      </View>
      <View className="flex-1 rounded-card border border-surface-border bg-surface-raised px-4 py-4">
        <Text className="font-sans text-sm text-zinc-400">Reviews</Text>
        <Text className="mt-1 font-display text-2xl text-white">
          {stats.data?.metrics.totalReviews ?? insights.total}
        </Text>
        {insights.eightWeekChangePct != null && (
          <View
            className="mt-1.5 flex-row items-center gap-1 self-start rounded-full px-2.5 py-1"
            style={{ backgroundColor: insights.eightWeekChangePct >= 0 ? `${t.emerald}26` : `${t.rose}26` }}
          >
            <Ionicons
              name={insights.eightWeekChangePct >= 0 ? 'caret-up' : 'caret-down'}
              size={11}
              color={insights.eightWeekChangePct >= 0 ? t.emerald : t.rose}
            />
            <Text
              className="font-sans-bold text-xs"
              style={{ color: insights.eightWeekChangePct >= 0 ? t.emerald : t.rose }}
            >
              {Math.abs(insights.eightWeekChangePct)}% last 8 w…
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * "Your Avg. Reviews / Week" + the 8-week bar chart — the other half of the
 * old ReviewTrendsSection, split out for the same reason as ReviewStatCards
 * above. Self-contained for the same reason.
 */
export function ReviewTrendsChart() {
  const { activeBusinessId } = useBusiness();

  const reviews = useQuery({
    queryKey: ['reviews', activeBusinessId],
    queryFn: fetchReviews,
    enabled: !!activeBusinessId,
  });

  const insights = reviews.data ? computeReviewInsights(reviews.data) : null;
  // Deliberately NOT audit?.auditData?.reviewAnalysis?.reviewsPerWeek — that
  // figure is a lifetime average (total reviews ÷ weeks since your very
  // first one), a completely different number from what the 8 bars below
  // show, which made the headline and the chart contradict each other on
  // the same screen. insights.avgPerWeek is computed over the exact same
  // 8-week window the bars use, so the two always agree now.
  //
  // industryAvg (the dashed benchmark line) has been removed the same way —
  // it was a hardcoded 4.2 for every business, not real data. WeeklyBars
  // already renders correctly with no benchmark line at all when it's
  // omitted; a real industry figure can be wired back in later if/when
  // there's an actual data source for it.
  const avgPerWeek = insights?.avgPerWeek ?? 0;

  if (reviews.isLoading) return <Skeleton className="h-40 rounded-card" />;
  if (!insights) return null;

  return (
    <>
      <View className="mb-3 flex-row items-center justify-between rounded-card border border-surface-border bg-surface-raised px-4 py-3.5">
        <Text className="font-sans text-base text-zinc-300">Your Avg. Reviews</Text>
        <Text className="font-display text-xl text-white">
          {avgPerWeek} <Text className="font-sans-semibold text-sm text-zinc-500">/ Week</Text>
        </Text>
      </View>
      <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-4">
        <WeeklyBars data={insights.weekly} />
      </View>
    </>
  );
}

/**
 * "Review Trends — last 8 weeks" — chart followed by the stat cards, the
 * Performance tab's original order (still matches its reference
 * screenshot). Kept as a compat wrapper around the two pieces above so
 * performance-tab.tsx didn't need to change.
 */
export function ReviewTrendsSection() {
  return (
    <>
      <ReviewTrendsChart />
      <View className="mb-4 mt-3">
        <ReviewStatCards />
      </View>
    </>
  );
}
