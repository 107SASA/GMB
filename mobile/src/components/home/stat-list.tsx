import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { fetchDashboardStats, fetchGbpInsights, fetchScheduledPostsCount } from '@/api/endpoints/dashboard';
import { fetchGbpMedia } from '@/api/endpoints/gbp';
import { fetchReviews } from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import { useLatestAudit } from '@/components/gbp/use-latest-audit';
import { Skeleton } from '@/components/ui';
import { computeReviewInsights } from '@/lib/review-insights';
import { useTheme } from '@/lib/theme';
import type { Palette } from '@/lib/theme';

interface StatRowData {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconTint: keyof Pick<Palette, 'amber' | 'violet' | 'cyan' | 'emerald' | 'rose' | 'brandBright'>;
  title: string;
  subtitle: string;
  badge?: { text: string; tone: 'warning' | 'info' };
  href: string;
}

function StatRow({ row }: { row: StatRowData }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(row.href as never)}
      // No `className` — react-native-css-interop can swallow onPress on
      // styled Pressables (see components/ui.tsx).
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}
    >
      <View
        className="h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: `${t[row.iconTint]}26` }}
      >
        <Ionicons name={row.icon} size={18} color={t[row.iconTint]} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="font-sans-bold text-[15px] text-white" numberOfLines={1}>
            {row.title}
          </Text>
          {row.badge && (
            <View
              className="rounded-full px-2 py-0.5"
              style={{ backgroundColor: row.badge.tone === 'warning' ? t.errorContainer : `${t.violet}33` }}
            >
              <Text
                className="font-sans-bold text-[10px]"
                style={{ color: row.badge.tone === 'warning' ? t.onErrorContainer : t.violet }}
              >
                {row.badge.text}
              </Text>
            </View>
          )}
        </View>
        <Text className="mt-0.5 font-sans text-xs text-zinc-500" numberOfLines={1}>
          {row.subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={t.textFaint} />
    </Pressable>
  );
}

/**
 * "At a glance" stat/menu list — SEO, Posts, Photos, Reviews, Performance —
 * each wired to data already fetched elsewhere in the app (the GBP hub's
 * former sub-tabs, the Photos tab, dashboard stats), just surfaced here as
 * one scannable list with a deep link into the relevant tab. Nothing here
 * is fabricated: rows show real counts, or an honest "not enough data yet"
 * subtitle when a source has none.
 */
export function HomeStatList() {
  const { activeBusinessId } = useBusiness();
  const { audit, isLoading: auditLoading } = useLatestAudit();

  const stats = useQuery({
    queryKey: ['dashboard-stats', activeBusinessId],
    queryFn: () => fetchDashboardStats(30),
    enabled: !!activeBusinessId,
  });
  const scheduledCount = useQuery({
    queryKey: ['scheduled-posts-count', activeBusinessId],
    queryFn: fetchScheduledPostsCount,
    enabled: !!activeBusinessId,
  });
  const media = useQuery({
    queryKey: ['gbp-media', activeBusinessId],
    queryFn: fetchGbpMedia,
    enabled: !!activeBusinessId,
    retry: false,
  });
  const reviews = useQuery({
    queryKey: ['reviews', activeBusinessId],
    queryFn: fetchReviews,
    enabled: !!activeBusinessId,
  });
  const gbpInsights = useQuery({
    queryKey: ['gbp-insights', activeBusinessId],
    queryFn: () => fetchGbpInsights(28),
    enabled: !!activeBusinessId,
  });

  const loading =
    stats.isLoading ||
    scheduledCount.isLoading ||
    media.isLoading ||
    reviews.isLoading ||
    gbpInsights.isLoading ||
    auditLoading;
  if (loading) {
    return (
      <View className="mx-4 mt-6 gap-2">
        <Skeleton className="h-16 rounded-card" />
        <Skeleton className="h-16 rounded-card" />
        <Skeleton className="h-16 rounded-card" />
      </View>
    );
  }

  // --- Profile SEO — from the latest audit, not a fabricated "updates" log ---
  const completion = audit?.auditData?.profileCompletion?.completionPercentage ?? null;
  const fixCount = audit?.auditData?.priorityFixes?.length ?? 0;

  // --- Photos — published vs staged (our real concept; Grexa's closest
  // equivalent is "scheduled", which we don't have for photos) ---
  const publishedPhotos = (media.data?.media ?? []).filter((m) => m.status === 'published').length;
  const stagedPhotos = (media.data?.media ?? []).filter((m) => m.status === 'staged').length;

  // --- Reviews — this week's count + reply rate from raw review docs ---
  // "This week" reuses the exact same rolling-7-day calculation the
  // Performance/Reviews tabs' chart uses (lib/review-insights.ts) instead of
  // a second hand-rolled copy of the same math — the two were previously
  // computed identically-but-separately, a maintenance risk (one could be
  // edited without the other) rather than a live discrepancy.
  const reviewList = reviews.data ?? [];
  const newThisWeek = computeReviewInsights(reviewList).thisWeek;
  const repliedPct = reviewList.length
    ? Math.round((reviewList.filter((r) => r.replyStatus === 'POSTED').length / reviewList.length) * 100)
    : null;

  // --- Performance — real period-over-period % change, same numbers the
  // Performance tab shows ---
  const viewsChange = gbpInsights.data?.changes?.views ?? null;

  const rows: StatRowData[] = [
    {
      key: 'seo',
      icon: 'storefront-outline',
      iconTint: 'brandBright',
      title: 'GBP Profile SEO',
      subtitle: completion != null ? `${completion}% complete` : 'Run an audit to see your SEO score',
      badge: fixCount > 0 ? { text: `${fixCount} fix${fixCount > 1 ? 'es' : ''}`, tone: 'info' } : undefined,
      href: '/audit',
    },
    {
      key: 'posts',
      icon: 'newspaper-outline',
      iconTint: 'amber',
      title: `${stats.data?.metrics.postsPublished ?? 0} Posts Published`,
      subtitle: `${scheduledCount.data ?? 0} scheduled`,
      href: '/posts',
    },
    {
      key: 'photos',
      icon: 'image-outline',
      iconTint: 'cyan',
      title: `${publishedPhotos} Photos/Videos Published`,
      subtitle: stagedPhotos > 0 ? `${stagedPhotos} staged, ready to publish` : 'No photos staged',
      badge: stagedPhotos > 0 ? { text: 'Needs action', tone: 'warning' } : undefined,
      href: '/photos',
    },
    {
      key: 'reviews',
      icon: 'star-outline',
      iconTint: 'emerald',
      title: `${newThisWeek} New Review${newThisWeek === 1 ? '' : 's'}`,
      subtitle: repliedPct != null ? `Replied ${repliedPct}%` : 'No reviews yet',
      href: '/reviews',
    },
    {
      key: 'performance',
      icon: 'stats-chart-outline',
      iconTint: 'violet',
      title: 'Performance Analysis',
      subtitle:
        viewsChange != null
          ? `Views ${viewsChange >= 0 ? 'up' : 'down'} ${Math.abs(viewsChange)}% vs last period`
          : 'View your performance trends',
      href: '/performance',
    },
  ];

  return (
    <View className="mx-4 mt-6 rounded-card border border-surface-border bg-surface-raised px-4">
      {rows.map((row, i) => (
        <View key={row.key}>
          {i > 0 && <View className="border-t border-surface-border" />}
          <StatRow row={row} />
        </View>
      ))}
    </View>
  );
}
