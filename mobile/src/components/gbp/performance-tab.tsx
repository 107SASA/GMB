import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchDashboardStats, fetchGbpInsights, syncGbpInsights } from '@/api/endpoints/dashboard';
import type { AuditCompetitor, AuditKeywordRank } from '@/api/endpoints/audit';
import { useBusiness } from '@/business/BusinessContext';
import { LineChart } from '@/components/charts';
import { useLatestAudit } from '@/components/gbp/use-latest-audit';
import { useKeywordChanges } from '@/components/gbp/use-keyword-changes';
import { RankMap } from '@/components/gbp/rank-map';
import { ReviewTrendsSection } from '@/components/gbp/review-trends-section';
import { GoogleG } from '@/components/google-g';
import { InfoSheet, Skeleton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

const SHOW_LIMIT = 5;
type TrendMetric = 'views' | 'callClicks' | 'directionRequests';
const TREND_TABS: { key: TrendMetric; label: string }[] = [
  { key: 'views', label: 'Views' },
  { key: 'callClicks', label: 'Calls' },
  { key: 'directionRequests', label: 'Directions' },
];

function fmtRank(rank: number | null): string {
  return rank == null ? '—' : rank.toFixed(1);
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <View className="flex-1 rounded-card border border-surface-border bg-surface-raised px-4 py-4">
      <Text className="font-sans text-sm text-zinc-400">{label}</Text>
      <Text className="mt-1 font-display text-2xl text-white">{value}</Text>
    </View>
  );
}

function SectionTitle({ children, hint }: { children: string; hint?: boolean }) {
  const t = useTheme();
  return (
    <View className="mb-3 mt-8 flex-row items-center gap-1.5">
      <Text className="font-display-bold text-lg text-white">{children}</Text>
      {!!hint && <Ionicons name="information-circle-outline" size={16} color={t.textFaint} />}
    </View>
  );
}

/** "Show more ⌄" toggle used under the keyword and competitor lists. */
function ShowMore({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      // No `className` — react-native-css-interop can swallow onPress on
      // styled Pressables (see components/ui.tsx).
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 12 }}
    >
      <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
        {expanded ? 'Show less' : 'Show more'}
      </Text>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={t.brandBright} />
    </Pressable>
  );
}

/** Rank-change badge — green "+0.4" (improved) / red "-0.4" (dropped) / "~" (no previous data or unchanged). */
function ChangeBadge({ change }: { change: number | null }) {
  const t = useTheme();
  if (change == null || Math.abs(change) < 0.05) {
    return (
      <View className="items-center justify-center rounded-lg bg-surface-overlay px-2 py-1">
        <Text className="font-sans-bold text-xs text-zinc-500">~</Text>
      </View>
    );
  }
  const improved = change > 0;
  return (
    <View
      className="items-center justify-center rounded-lg px-2 py-1"
      style={{ backgroundColor: improved ? `${t.emerald}26` : `${t.rose}26` }}
    >
      <Text className="font-sans-bold text-xs" style={{ color: improved ? t.emerald : t.rose }}>
        {improved ? '+' : '-'}
        {Math.abs(change).toFixed(1)}
      </Text>
    </View>
  );
}

function KeywordRows({
  keywords,
  previousRankByKeyword,
}: {
  keywords: AuditKeywordRank[];
  previousRankByKeyword: Map<string, number>;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? keywords : keywords.slice(0, SHOW_LIMIT);
  return (
    <View className="overflow-hidden rounded-card border border-surface-border bg-surface-raised">
      <View className="flex-row items-center border-b border-surface-border px-4 py-3">
        <Text className="flex-1 font-sans-bold text-xs uppercase tracking-wide text-zinc-500">
          Keywords
        </Text>
        <Text className="w-14 text-right font-sans-bold text-xs uppercase tracking-wide text-zinc-500">
          Rank
        </Text>
        <Text className="w-16 text-right font-sans-bold text-xs uppercase tracking-wide text-zinc-500">
          Change
        </Text>
      </View>
      {rows.map((kw, i) => {
        const currentRank = kw.rank ?? kw.avgRank;
        const prevRank = previousRankByKeyword.get(kw.keyword);
        const change = prevRank != null && currentRank != null ? prevRank - currentRank : null;
        return (
          <View
            key={kw.keyword + i}
            className="flex-row items-center gap-3 border-b border-surface-border px-4 py-3.5 last:border-b-0"
          >
            <Text className="w-5 font-sans text-sm text-zinc-500">{i + 1}</Text>
            <Text className="flex-1 font-sans text-base text-zinc-200" numberOfLines={1}>
              {kw.keyword}
            </Text>
            <Text className="w-14 text-right font-sans-bold text-base text-white">
              {fmtRank(currentRank)}
            </Text>
            <View className="w-16 items-end">
              <ChangeBadge change={change} />
            </View>
          </View>
        );
      })}
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
    <View className="overflow-hidden rounded-card border border-surface-border bg-surface-raised">
      <View className="flex-row items-center border-b border-surface-border px-4 py-3">
        <Text className="flex-1 font-sans-bold text-xs uppercase tracking-wide text-zinc-500">
          Competitor
        </Text>
        <Text className="w-20 text-right font-sans-bold text-xs uppercase tracking-wide text-zinc-500">
          Reviews
        </Text>
        <Text className="w-14 text-right font-sans-bold text-xs uppercase tracking-wide text-zinc-500">
          Rank
        </Text>
      </View>
      {rows.map((c, i) => (
        <View
          key={c.name + i}
          className="flex-row items-center border-b border-surface-border px-4 py-3.5"
        >
          <View className="flex-1 pr-2">
            <Text className="font-sans-semibold text-base text-white" numberOfLines={1}>
              {c.name}
            </Text>
            {c.rating != null && (
              <View className="mt-0.5 flex-row items-center gap-1">
                <Ionicons name="star" size={12} color={t.amber} />
                <Text className="font-sans text-xs text-zinc-400">{c.rating}</Text>
              </View>
            )}
          </View>
          <Text className="w-20 text-right font-sans-semibold text-base" style={{ color: t.emerald }}>
            {c.reviewCount ?? '—'}
          </Text>
          <Text className="w-14 text-right font-sans-bold text-base text-white">
            {fmtRank(c.estimatedRank ?? c.avgRank)}
          </Text>
        </View>
      ))}
      {/* Your business — highlighted row, like the reference app */}
      <View className="flex-row items-center bg-warning-container/50 px-4 py-3.5">
        <View className="flex-1 pr-2">
          <Text className="font-sans-semibold text-base text-white" numberOfLines={1}>
            {you.name}
          </Text>
          {you.rating != null && (
            <View className="mt-0.5 flex-row items-center gap-1">
              <Ionicons name="star" size={12} color={t.amber} />
              <Text className="font-sans text-xs text-zinc-400">{you.rating}</Text>
            </View>
          )}
        </View>
        <Text className="w-20 text-right font-sans-bold text-base text-on-warning-container">
          {you.reviews ?? '—'}
        </Text>
        <Text className="w-14 text-right font-sans-bold text-base text-on-warning-container">
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
  const queryClient = useQueryClient();
  const { audit, isLoading: auditLoading } = useLatestAudit();
  const { previousRankByKeyword } = useKeywordChanges();
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('views');
  const [infoVisible, setInfoVisible] = useState(false);

  const gbp = useQuery({
    queryKey: ['gbp-insights', activeBusinessId],
    queryFn: () => fetchGbpInsights(28),
    enabled: !!activeBusinessId,
  });

  // Pulls fresh data from Google right now — views/calls/directions,
  // keywords, profile fields, and (once, ever, per business) the 6-month
  // history backfill — instead of waiting for the nightly cron. Previously
  // this tab had no way to trigger a fresh pull at all.
  const sync = useMutation({
    mutationFn: syncGbpInsights,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gbp-insights', activeBusinessId] });
    },
    onError: (error) => Alert.alert('Sync failed', getApiErrorMessage(error, 'Please try again.')),
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
  const allCompetitors = [...(data?.competitors ?? []), ...(data?.localPackCompetitors ?? [])]
    .filter((c): c is AuditCompetitor => c !== null)
    .filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i)
    .sort((a, b) => (a.estimatedRank ?? a.avgRank ?? 99) - (b.estimatedRank ?? b.avgRank ?? 99));
  // "Ahead of You" should mean it — only competitors who actually outrank you
  // (lower number = better). When we don't have your own rank yet, fall back
  // to the full list rather than hiding everything.
  const competitors =
    avgRank != null
      ? allCompetitors.filter((c) => (c.estimatedRank ?? c.avgRank ?? Infinity) < avgRank)
      : allCompetitors;
  const geo = data?.geoGridRank ?? null;
  const auditDate = audit?.createdAt
    ? new Date(audit.createdAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;
  // Real, specific — not "AI is working on optimisations" (implies
  // autonomous background work we don't do; see ai-agent-card.tsx /
  // ProfileActivity.ts for why that distinction matters in this codebase).
  const topPriorityFix = data?.priorityFixes?.[0] ?? null;
  const monthlyTrend = gbp.data?.monthlyTrend ?? [];

  return (
    <View className="px-4">
      {/* GBP Performance — last 30 days */}
      <View className="flex-row items-center justify-between gap-2 pt-2">
        <View className="flex-row items-center gap-2">
          <GoogleG size={18} />
          <View>
            <View className="flex-row items-center gap-1">
              <Text className="font-display-bold text-lg text-white">GBP Performance</Text>
              <Pressable onPress={() => setInfoVisible(true)} hitSlop={8}>
                <Ionicons name="information-circle-outline" size={16} color={t.textFaint} />
              </Pressable>
            </View>
            <Text className="font-sans text-xs text-zinc-500">Last 28 days</Text>
          </View>
        </View>
        <Pressable
          onPress={() => sync.mutate()}
          disabled={sync.isPending}
          // No `className` — react-native-css-interop can swallow onPress
          // on styled Pressables (see components/ui.tsx).
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: sync.isPending ? 0.5 : 1 }}
        >
          <Ionicons name="refresh" size={16} color={t.brandBright} />
          <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
            {sync.isPending ? 'Syncing…' : 'Sync'}
          </Text>
        </Pressable>
      </View>

      {/* Real, specific next step from your own audit — not a vague "AI is
          optimizing" claim (see topPriorityFix comment above). */}
      {topPriorityFix && (
        <Pressable
          onPress={() => router.push(`/audit/${audit!._id}?highlight=priorityFixes-0`)}
          // No `className` — see note above.
          style={{
            marginTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            borderRadius: 16,
            backgroundColor: `${t.brandBright}1a`,
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          <Ionicons name="sparkles" size={16} color={t.brandBright} />
          <Text className="flex-1 font-sans text-sm leading-5" style={{ color: t.brandBright }}>
            Next priority: <Text className="font-sans-bold">{topPriorityFix.title}</Text>
          </Text>
        </Pressable>
      )}

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
      <View className="mt-3 rounded-card border border-surface-border bg-surface-raised px-4 py-4">
        <Text className="font-sans text-sm text-zinc-400">Latest Google Rank</Text>
        <View className="mt-1 flex-row items-center justify-between">
          <Text className="font-display text-3xl text-white">
            {auditLoading ? '…' : fmtRank(avgRank)}
          </Text>
          <Pressable
            onPress={() => router.push('/audit/run')}
            // No `className` — see note above.
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Ionicons name="refresh" size={16} color={t.brandBright} />
            <Text className="font-sans-bold text-base" style={{ color: t.brandBright }}>
              Refresh
            </Text>
          </Pressable>
        </View>
        <Text className="mt-1 font-sans text-xs text-zinc-500">
          Lower is better{auditDate ? ` • Last updated on ${auditDate}` : ' • Run an audit to get your rank'}
        </Text>
      </View>

      {!!avgRank && (
        <View className="mt-3 flex-row items-center gap-2 rounded-full bg-surface-overlay px-4 py-2.5">
          <GoogleG size={14} />
          <Text className="flex-1 font-sans text-xs text-zinc-400">
            Rankings may keep improving as Google processes your changes.
          </Text>
        </View>
      )}

      {/* Last 6 months trends */}
      <SectionTitle>Last 6 Months Trends</SectionTitle>
      <View className="flex-row gap-2">
        {TREND_TABS.map((tab) => {
          const active = trendMetric === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setTrendMetric(tab.key)}
              // No `className` — see note above.
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? t.brandBright : t.border,
                backgroundColor: active ? `${t.brandBright}1a` : 'transparent',
                paddingHorizontal: 14,
                paddingVertical: 8,
              }}
            >
              <Text className="font-sans-bold text-sm" style={{ color: active ? t.brandBright : t.textFaint }}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {gbp.isLoading ? (
        <Skeleton className="mt-3 h-40" />
      ) : (
        <View className="mt-3 rounded-card border border-surface-border bg-surface-raised px-4 py-4">
          <LineChart
            points={monthlyTrend.map((m) => ({ label: m.month, value: m[trendMetric] }))}
            color={t.brandBright}
          />
        </View>
      )}

      {/* Competitors ahead of you — moved above Keywords to match the
          reference app's order. */}
      <SectionTitle>Competitors Ahead of You</SectionTitle>
      {auditLoading ? (
        <Skeleton className="h-56" />
      ) : competitors.length > 0 ? (
        <CompetitorRows
          competitors={competitors}
          you={{
            name: activeBusiness?.name ?? 'Your business',
            rating: stats.data?.metrics.avgRating ?? data?.reviewAnalysis?.averageRating ?? null,
            reviews:
              stats.data?.metrics.totalReviews ?? data?.reviewAnalysis?.reviewCount ?? null,
            rank: avgRank,
          }}
        />
      ) : allCompetitors.length > 0 ? (
        <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-5">
          <Text className="font-sans text-sm text-zinc-400">
            🎉 None of your tracked competitors currently outrank you — nice work!
          </Text>
        </View>
      ) : (
        <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-5">
          <Text className="font-sans text-sm text-zinc-400">
            Competitor comparison appears after your next audit.
          </Text>
        </View>
      )}

      {/* Rank for targeted keywords */}
      <SectionTitle hint>Rank for Targeted Keywords</SectionTitle>
      {auditLoading ? (
        <Skeleton className="h-48" />
      ) : keywords.length > 0 ? (
        <KeywordRows keywords={keywords} previousRankByKeyword={previousRankByKeyword} />
      ) : (
        <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-5">
          <Text className="font-sans text-sm text-zinc-400">
            No keyword ranks yet — run an audit to track where you rank for your target searches.
          </Text>
        </View>
      )}

      {/* Rank by location — real geo-grid map image (see rank-map.tsx),
          reusing the web dashboard's existing static-map endpoint. */}
      <SectionTitle>Rank by Location</SectionTitle>
      {geo?.keywords?.[0]?.keyword && audit ? (
        <>
          <View className="mb-3 self-start rounded-full bg-surface-overlay px-3 py-2">
            <Text className="font-sans text-sm text-zinc-300">Keyword: {geo.keywords[0].keyword}</Text>
          </View>
          <RankMap auditId={audit._id} kwIndex={0} lastUpdated={auditDate} />
        </>
      ) : (
        <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-5">
          <Text className="font-sans text-sm text-zinc-400">
            Location grid data appears after your next audit.
          </Text>
        </View>
      )}

      {/* Review trends — extracted to review-trends-section.tsx (Aug 2026),
          now also shown on the Reviews tab, matching the reference app. */}
      <SectionTitle>Review Trends — last 8 weeks</SectionTitle>
      <ReviewTrendsSection />

      <InfoSheet
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="GBP Performance"
        message="Views, calls and direction requests are pulled from your Google Business Profile for the selected period. Latest Google Rank is your average position across the keywords tracked in your last audit — lower is better."
      />
    </View>
  );
}
