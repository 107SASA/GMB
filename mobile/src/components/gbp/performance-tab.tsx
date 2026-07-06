import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fetchDashboardStats, fetchGbpInsights } from '@/api/endpoints/dashboard';
import { fetchReviews } from '@/api/endpoints/reviews';
import type { AuditCompetitor, AuditKeywordRank } from '@/api/endpoints/audit';
import { useBusiness } from '@/business/BusinessContext';
import { WeeklyBars } from '@/components/charts';
import { useLatestAudit } from '@/components/gbp/use-latest-audit';
import { Skeleton } from '@/components/ui';
import { computeReviewInsights } from '@/lib/review-insights';
import { useTheme } from '@/lib/theme';

const SHOW_LIMIT = 5;

function fmtRank(rank: number | null): string {
  return rank == null ? '—' : rank.toFixed(1);
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <View className="flex-1 rounded-2xl border border-surface-border bg-surface-raised px-4 py-4">
      <Text className="text-sm text-zinc-400">{label}</Text>
      <Text className="mt-1 text-2xl font-extrabold text-white">{value}</Text>
    </View>
  );
}

function SectionTitle({ children, hint }: { children: string; hint?: boolean }) {
  const t = useTheme();
  return (
    <View className="mb-3 mt-8 flex-row items-center gap-1.5">
      <Text className="text-lg font-extrabold text-white">{children}</Text>
      {!!hint && <Ionicons name="information-circle-outline" size={16} color={t.textFaint} />}
    </View>
  );
}

/** "Show more ⌄" toggle used under the keyword and competitor lists. */
function ShowMore({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-1 px-1 py-3 active:opacity-70">
      <Text className="text-sm font-bold" style={{ color: t.brandBright }}>
        {expanded ? 'Show less' : 'Show more'}
      </Text>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={t.brandBright} />
    </Pressable>
  );
}

function KeywordRows({ keywords }: { keywords: AuditKeywordRank[] }) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? keywords : keywords.slice(0, SHOW_LIMIT);
  return (
    <View className="overflow-hidden rounded-2xl border border-surface-border bg-surface-raised">
      <View className="flex-row items-center border-b border-surface-border px-4 py-3">
        <Text className="flex-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Keywords
        </Text>
        <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Rank (Change)
        </Text>
      </View>
      {rows.map((kw, i) => (
        <View
          key={kw.keyword + i}
          className="flex-row items-center gap-3 border-b border-surface-border px-4 py-3.5 last:border-b-0"
        >
          <Text className="w-5 text-sm text-zinc-500">{i + 1}</Text>
          <Text className="flex-1 text-base text-zinc-200" numberOfLines={1}>
            {kw.keyword}
          </Text>
          <Text className="text-base font-bold text-white">{fmtRank(kw.rank ?? kw.avgRank)}</Text>
          <View className="rounded-lg px-2 py-1" style={{ backgroundColor: `${t.brand}26` }}>
            <Text className="text-xs font-bold" style={{ color: t.brandBright }}>
              New
            </Text>
          </View>
        </View>
      ))}
      {keywords.length > SHOW_LIMIT && (
        <ShowMore expanded={expanded} onPress={() => setExpanded((v) => !v)} />
      )}
    </View>
  );
}

function CompetitorRows({
  competitors,
  you,
}: {
  competitors: AuditCompetitor[];
  you: { name: string; rating: number | null; reviews: number | null; rank: number | null };
}) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? competitors : competitors.slice(0, 4);
  return (
    <View className="overflow-hidden rounded-2xl border border-surface-border bg-surface-raised">
      <View className="flex-row items-center border-b border-surface-border px-4 py-3">
        <Text className="flex-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Competitor
        </Text>
        <Text className="w-20 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Reviews
        </Text>
        <Text className="w-14 text-right text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Rank
        </Text>
      </View>
      {rows.map((c, i) => (
        <View
          key={c.name + i}
          className="flex-row items-center border-b border-surface-border px-4 py-3.5"
        >
          <View className="flex-1 pr-2">
            <Text className="text-base font-semibold text-white" numberOfLines={1}>
              {c.name}
            </Text>
            {c.rating != null && (
              <View className="mt-0.5 flex-row items-center gap-1">
                <Ionicons name="star" size={12} color={t.amber} />
                <Text className="text-xs text-zinc-400">{c.rating}</Text>
              </View>
            )}
          </View>
          <Text className="w-20 text-right text-base font-bold" style={{ color: t.emerald }}>
            {c.reviewCount ?? '—'}
          </Text>
          <Text className="w-14 text-right text-base font-bold text-white">
            {fmtRank(c.estimatedRank ?? c.avgRank)}
          </Text>
        </View>
      ))}
      {/* Your business — highlighted row, like the reference app */}
      <View
        className="flex-row items-center px-4 py-3.5"
        style={{ backgroundColor: `${t.amber}20` }}
      >
        <View className="flex-1 pr-2">
          <Text className="text-base font-semibold text-white" numberOfLines={1}>
            {you.name}
          </Text>
          {you.rating != null && (
            <View className="mt-0.5 flex-row items-center gap-1">
              <Ionicons name="star" size={12} color={t.amber} />
              <Text className="text-xs text-zinc-400">{you.rating}</Text>
            </View>
          )}
        </View>
        <Text className="w-20 text-right text-base font-bold" style={{ color: t.amber }}>
          {you.reviews ?? '—'}
        </Text>
        <Text className="w-14 text-right text-base font-bold" style={{ color: t.amber }}>
          {fmtRank(you.rank)}
        </Text>
      </View>
      {competitors.length > 4 && (
        <ShowMore expanded={expanded} onPress={() => setExpanded((v) => !v)} />
      )}
    </View>
  );
}

/**
 * GBP → Performance: 30-day stats, latest Google rank, targeted keyword
 * ranks, geo-grid summary, competitors table and review trends — everything
 * sourced from /api/gbp/insights, /api/reviews and the latest audit.
 */
export function PerformanceTab() {
  const { activeBusiness, activeBusinessId } = useBusiness();
  const router = useRouter();
  const t = useTheme();
  const { audit, isLoading: auditLoading } = useLatestAudit();

  const gbp = useQuery({
    queryKey: ['gbp-insights', activeBusinessId],
    queryFn: () => fetchGbpInsights(28),
    enabled: !!activeBusinessId,
  });
  const reviews = useQuery({
    queryKey: ['reviews', activeBusinessId],
    queryFn: fetchReviews,
    enabled: !!activeBusinessId,
  });
  // Rating / total reviews come from /api/dashboard/stats — the same numbers
  // the web dashboard shows, so the app never disagrees with the site.
  const stats = useQuery({
    queryKey: ['dashboard-stats', activeBusinessId],
    queryFn: () => fetchDashboardStats(30),
    enabled: !!activeBusinessId,
  });

  const data = audit?.auditData ?? null;
  // Same fallback order as the web audit report: geo-grid rank first.
  const avgRank =
    data?.geoGridRank?.overallAvgRank ?? data?.googleSearchRank?.averageRank ?? null;
  const keywords = (data?.googleSearchRank?.topKeywords ?? []).filter(
    (k): k is AuditKeywordRank => !!k && !!k.keyword
  );
  const competitors = [...(data?.competitors ?? []), ...(data?.localPackCompetitors ?? [])]
    .filter((c): c is AuditCompetitor => c !== null)
    .filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i)
    .sort((a, b) => (a.estimatedRank ?? a.avgRank ?? 99) - (b.estimatedRank ?? b.avgRank ?? 99));
  const geo = data?.geoGridRank ?? null;
  const insights = reviews.data ? computeReviewInsights(reviews.data) : null;
  const industryAvg = data?.reviewAnalysis?.industryAverage ?? null;
  // The website's audit reports Google's true reviews/week; the client-side
  // fallback counts synced docs (their createdAt is the sync date, which
  // over-counts after a bulk import) — only used when no audit exists.
  const avgPerWeek = data?.reviewAnalysis?.reviewsPerWeek ?? insights?.avgPerWeek ?? 0;
  const auditDate = audit?.createdAt
    ? new Date(audit.createdAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <View className="px-4">
      {/* GBP Performance — last 30 days */}
      <View className="flex-row items-center gap-2 pt-2">
        <Ionicons name="logo-google" size={18} color={t.brandBright} />
        <View>
          <Text className="text-lg font-extrabold text-white">GBP Performance</Text>
          <Text className="text-xs text-zinc-500">Last 28 days</Text>
        </View>
      </View>

      {gbp.isLoading ? (
        <Skeleton className="mt-3 h-24" />
      ) : (
        <View className="mt-3 flex-row gap-3">
          <StatCard label="Views" value={gbp.data?.summary?.totalViews ?? '—'} />
          <StatCard label="Calls" value={gbp.data?.summary?.totalCallClicks ?? '—'} />
          <StatCard label="Directions" value={gbp.data?.summary?.totalDirectionRequests ?? '—'} />
        </View>
      )}

      {/* Latest Google Rank */}
      <View className="mt-3 rounded-2xl border border-surface-border bg-surface-raised px-4 py-4">
        <Text className="text-sm text-zinc-400">Latest Google Rank</Text>
        <View className="mt-1 flex-row items-center justify-between">
          <Text className="text-3xl font-extrabold text-white">
            {auditLoading ? '…' : fmtRank(avgRank)}
          </Text>
          <Pressable
            onPress={() => router.push('/audit/run')}
            className="flex-row items-center gap-1.5 active:opacity-70"
          >
            <Ionicons name="refresh" size={16} color={t.brandBright} />
            <Text className="text-base font-bold" style={{ color: t.brandBright }}>
              Refresh
            </Text>
          </Pressable>
        </View>
        <Text className="mt-1 text-xs text-zinc-500">
          Lower is better{auditDate ? ` • Last updated on ${auditDate}` : ' • Run an audit to get your rank'}
        </Text>
      </View>

      {/* Rank for targeted keywords */}
      <SectionTitle hint>Rank for Targeted Keywords</SectionTitle>
      {auditLoading ? (
        <Skeleton className="h-48" />
      ) : keywords.length > 0 ? (
        <KeywordRows keywords={keywords} />
      ) : (
        <View className="rounded-2xl border border-surface-border bg-surface-raised px-4 py-5">
          <Text className="text-sm text-zinc-400">
            No keyword ranks yet — run an audit to track where you rank for your target searches.
          </Text>
        </View>
      )}

      {/* Rank by location (geo grid summary) */}
      <SectionTitle>Rank by Location</SectionTitle>
      {geo && (geo.overallAvgRank != null || (geo.keywords ?? []).length > 0) ? (
        <View className="rounded-2xl border border-surface-border bg-surface-raised px-4 py-4">
          {geo.keywords?.[0]?.keyword ? (
            <View className="mb-3 self-start rounded-xl bg-surface-overlay px-3 py-2">
              <Text className="text-sm text-zinc-300">Keyword: {geo.keywords[0].keyword}</Text>
            </View>
          ) : null}
          <View className="flex-row items-center gap-4">
            <View
              className="h-16 w-16 items-center justify-center rounded-full"
              style={{ backgroundColor: `${t.rose}33` }}
            >
              <Text className="text-lg font-extrabold" style={{ color: t.rose }}>
                {geo.overallAvgRank != null && geo.overallAvgRank > 20
                  ? '20+'
                  : fmtRank(geo.overallAvgRank)}
              </Text>
            </View>
            <Text className="flex-1 text-sm leading-5 text-zinc-400">
              Average rank across the locations around you. Open the web dashboard for the full
              map view.
            </Text>
          </View>
        </View>
      ) : (
        <View className="rounded-2xl border border-surface-border bg-surface-raised px-4 py-5">
          <Text className="text-sm text-zinc-400">
            Location grid data appears after your next audit.
          </Text>
        </View>
      )}

      {/* Competitors ahead of you */}
      <SectionTitle>Competitors Ahead of You</SectionTitle>
      {auditLoading ? (
        <Skeleton className="h-56" />
      ) : competitors.length > 0 ? (
        <CompetitorRows
          competitors={competitors}
          you={{
            name: activeBusiness?.name ?? 'Your business',
            // Same numbers the website dashboard shows; audit snapshot only
            // as fallback (it can lag behind the live review count).
            rating: stats.data?.metrics.avgRating ?? data?.reviewAnalysis?.averageRating ?? null,
            reviews:
              stats.data?.metrics.totalReviews ?? data?.reviewAnalysis?.reviewCount ?? null,
            rank: avgRank,
          }}
        />
      ) : (
        <View className="rounded-2xl border border-surface-border bg-surface-raised px-4 py-5">
          <Text className="text-sm text-zinc-400">
            Competitor comparison appears after your next audit.
          </Text>
        </View>
      )}

      {/* Review trends */}
      <SectionTitle>Review Trends — last 8 weeks</SectionTitle>
      {reviews.isLoading ? (
        <Skeleton className="h-56" />
      ) : insights ? (
        <>
          <View className="mb-3 flex-row items-center justify-between rounded-2xl border border-surface-border bg-surface-raised px-4 py-3.5">
            <Text className="text-base text-zinc-300">Your Avg. Reviews</Text>
            <Text className="text-xl font-extrabold text-white">
              {avgPerWeek} <Text className="text-sm font-medium text-zinc-500">/ Week</Text>
            </Text>
          </View>
          <View className="rounded-2xl border border-surface-border bg-surface-raised px-4 py-4">
            <WeeklyBars data={insights.weekly} industryAvg={industryAvg} />
          </View>
          <View className="mb-4 mt-3 flex-row gap-3">
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
              {insights.eightWeekChangePct != null && (
                <View
                  className="mt-1.5 flex-row items-center gap-1 self-start rounded-lg px-2 py-1"
                  style={{
                    backgroundColor:
                      insights.eightWeekChangePct >= 0 ? `${t.emerald}26` : `${t.rose}26`,
                  }}
                >
                  <Ionicons
                    name={insights.eightWeekChangePct >= 0 ? 'caret-up' : 'caret-down'}
                    size={11}
                    color={insights.eightWeekChangePct >= 0 ? t.emerald : t.rose}
                  />
                  <Text
                    className="text-xs font-bold"
                    style={{ color: insights.eightWeekChangePct >= 0 ? t.emerald : t.rose }}
                  >
                    {Math.abs(insights.eightWeekChangePct)}% last 8 w…
                  </Text>
                </View>
              )}
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}
