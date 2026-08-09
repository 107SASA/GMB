import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { fetchDashboardStats } from '@/api/endpoints/dashboard';
import { fetchReviews } from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import { WeeklyBars } from '@/components/charts';
import { useLatestAudit } from '@/components/gbp/use-latest-audit';
import { Skeleton } from '@/components/ui';
import { computeReviewInsights } from '@/lib/review-insights';
import { useTheme } from '@/lib/theme';

/**
 * "Review Trends — last 8 weeks" — self-contained (fetches its own reviews/
 * stats/audit data via React Query, so it's cheap to drop into more than one
 * screen; the underlying queries are cache-shared by key, not re-fetched
 * per usage). Originally only on the Performance tab; the reference app
 * shows the identical section on Reviews too, so this was extracted out of
 * performance-tab.tsx rather than copy-pasted a second time.
 */
export function ReviewTrendsSection() {
  const { activeBusinessId } = useBusiness();
  const t = useTheme();
  const { audit } = useLatestAudit();

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
  const industryAvg = audit?.auditData?.reviewAnalysis?.industryAverage ?? null;
  const avgPerWeek = audit?.auditData?.reviewAnalysis?.reviewsPerWeek ?? insights?.avgPerWeek ?? 0;

  if (reviews.isLoading) return <Skeleton className="h-56 rounded-card" />;
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
        <WeeklyBars data={insights.weekly} industryAvg={industryAvg} />
      </View>
      <View className="mb-4 mt-3 flex-row gap-3">
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
    </>
  );
}
