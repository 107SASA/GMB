import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchGrowthReport, formatMoney, type GrowthChange } from '@/api/endpoints/crm';
import { useBusiness } from '@/business/BusinessContext';
import { BackChevron, EmptyState, Screen, Skeleton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * Customer CRM — Monthly Growth Report (mobile). Same endpoint and numbers as
 * the web report (GET /api/crm/growth-report); this screen only formats them.
 */

function Card({ title, icon, children }: { title?: string; icon?: keyof typeof Ionicons.glyphMap; children: ReactNode }) {
  const t = useTheme();
  return (
    <View className="mb-3 rounded-card border border-surface-border bg-surface-raised px-4 py-4">
      {!!title && (
        <View className="mb-3 flex-row items-center gap-2">
          {!!icon && <Ionicons name={icon} size={16} color={t.brandBright} />}
          <Text className="font-sans-bold text-sm text-white">{title}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

function Row({ label, value, tone }: { label: string; value: ReactNode; tone?: 'up' | 'down' }) {
  return (
    <View className="flex-row items-center justify-between border-b border-surface-border py-2">
      <Text className="flex-1 pr-3 font-sans text-sm text-zinc-400">{label}</Text>
      <Text className={`font-sans-semibold text-sm ${tone === 'up' ? 'text-emerald-400' : tone === 'down' ? 'text-rose-400' : 'text-white'}`}>{value}</Text>
    </View>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <View className="mb-3 w-[48%] rounded-card border border-surface-border bg-surface-raised px-3 py-3">
      <Text className="font-sans text-xs text-zinc-500">{label}</Text>
      <Text className="mt-1 font-display-bold text-xl text-white" numberOfLines={1}>{value}</Text>
      {!!sub && <Text className="mt-0.5 font-sans text-[11px] text-zinc-500">{sub}</Text>}
    </View>
  );
}

function changeLabel(c: GrowthChange, currency: string): { text: string; tone?: 'up' | 'down' } {
  if (c.kind === 'rate') {
    if (c.pointChange == null) return { text: 'Not comparable' };
    return { text: `${c.pointChange > 0 ? '+' : ''}${c.pointChange.toFixed(1)} pts`, tone: c.pointChange > 0 ? 'up' : c.pointChange < 0 ? 'down' : undefined };
  }
  if (c.percentChange != null) return { text: `${c.percentChange > 0 ? '+' : ''}${c.percentChange}%`, tone: c.percentChange > 0 ? 'up' : c.percentChange < 0 ? 'down' : undefined };
  if ((c.previous ?? 0) === 0 && (c.current ?? 0) > 0) return { text: `up from ${c.kind === 'money' ? formatMoney(0, currency) : '0'}`, tone: 'up' };
  return { text: 'No change' };
}

function MonthButton({ label, icon, onPress }: { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      // No `className` — react-native-css-interop can swallow onPress on styled Pressables.
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, paddingHorizontal: 12, paddingVertical: 7 }}
    >
      {icon === 'chevron-back' && <Ionicons name={icon} size={14} color={t.brandBright} />}
      <Text className="font-sans-semibold text-xs text-zinc-200">{label}</Text>
      {icon === 'chevron-forward' && <Ionicons name={icon} size={14} color={t.brandBright} />}
    </Pressable>
  );
}

export default function GrowthReportScreen() {
  const router = useRouter();
  const t = useTheme();
  const params = useLocalSearchParams<{ month?: string }>();
  const { activeBusinessId } = useBusiness();
  const [month, setMonth] = useState<string | null>(typeof params.month === 'string' ? params.month : null);

  const q = useQuery({
    queryKey: ['crm-growth-report', activeBusinessId, month ?? 'latest'],
    queryFn: () => fetchGrowthReport(month),
    enabled: !!activeBusinessId,
  });
  const r = q.data;
  const cur = r?.currency ?? 'INR';
  const money = (v: number | null | undefined) => formatMoney(v, cur);
  const m = r?.metrics;

  return (
    <Screen>
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <BackChevron />
        </Pressable>
        <View className="flex-1">
          <Text className="font-display-bold text-lg text-white">Monthly Growth</Text>
          {!!r && <Text className="font-sans text-xs text-zinc-500" numberOfLines={1}>{r.business.name}</Text>}
        </View>
      </View>

      {q.isLoading ? (
        <View className="gap-3 px-5 pt-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </View>
      ) : q.isError || !r || !m ? (
        <EmptyState title="Couldn't load the report" hint={getApiErrorMessage(q.error, 'Pull down to retry.')} />
      ) : (
        <ScrollView
          contentContainerClassName="px-5 pb-10 pt-4"
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brandBright} />}
        >
          {/* Month selector */}
          <Text className="font-display-bold text-xl text-white">{r.period.label}</Text>
          <Text className="mb-3 font-sans text-xs text-zinc-500">{r.period.rangeLabel}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pb-4">
            <MonthButton label="Previous" icon="chevron-back" onPress={() => setMonth(r.period.prevKey)} />
            {!!r.period.nextKey && (
              <MonthButton
                label={r.period.nextKey === r.period.currentKey ? 'This month so far' : 'Next'}
                icon="chevron-forward"
                onPress={() => setMonth(r.period.nextKey === r.period.currentKey ? 'current' : r.period.nextKey)}
              />
            )}
            {!r.period.complete && <MonthButton label="Latest completed month" onPress={() => setMonth(r.period.latestCompleteKey)} />}
          </ScrollView>

          {!r.period.complete && (
            <Card>
              <Text className="font-sans text-sm text-zinc-300">
                This month is still in progress. These are month-to-date numbers, compared with the same days of last month.
              </Text>
            </Card>
          )}

          {/* Summary */}
          <Card title="What happened" icon="document-text-outline">
            {r.summary.data.map((s) => <Text key={s} className="mb-1 font-sans text-sm text-zinc-200">{s}</Text>)}
            {r.summary.interpretation.length > 0 && (
              <>
                <Text className="mb-1 mt-2 font-sans-bold text-xs uppercase tracking-wider text-zinc-500">What the numbers suggest</Text>
                {r.summary.interpretation.map((s) => <Text key={s} className="mb-1 font-sans text-sm text-zinc-300">• {s}</Text>)}
              </>
            )}
          </Card>

          {/* Key metrics */}
          <View className="flex-row flex-wrap justify-between">
            <Tile label="Leads received" value={String(m.leadsReceived)} />
            <Tile label="Won" value={String(m.won)} sub={m.wonWithoutValue > 0 ? `${m.wonWithoutValue} without a value` : null} />
            <Tile label="Conversion" value={m.conversionRate == null ? '—' : `${m.conversionRate}%`} sub="Won ÷ leads received" />
            <Tile label="Recorded revenue" value={money(m.revenue)} sub={m.revenue === 0 ? `${money(0)} recorded` : 'From Won deal values'} />
          </View>
          <Card title="ROI" icon="trending-up-outline">
            <Text className="font-display-bold text-xl text-white">{r.roi.roiPercent == null ? 'Unavailable' : `${r.roi.roiPercent}%`}</Text>
            <Text className="mt-1 font-sans text-xs text-zinc-500">
              {r.roi.roiPercent == null ? r.roi.note : `Revenue ${money(r.roi.revenue)} vs investment ${money(r.roi.investment)}`}
            </Text>
          </Card>

          {/* Month over month */}
          <Card title={`Compared with ${r.comparison.previousLabel}`} icon="swap-vertical-outline">
            {r.comparison.available ? (
              ([
                ['Leads', r.comparison.leads],
                ['Won', r.comparison.won],
                ['Recorded revenue', r.comparison.revenue],
                ['Conversion rate', r.comparison.conversionRate],
                ['Follow-up completion', r.comparison.followUpCompletionRate],
              ] as Array<[string, GrowthChange]>).map(([label, c]) => {
                const ch = changeLabel(c, cur);
                return <Row key={label} label={label} value={ch.text} tone={ch.tone} />;
              })
            ) : (
              <Text className="font-sans text-sm text-zinc-400">{r.comparison.note}</Text>
            )}
          </Card>

          {/* Sources */}
          <Card title="Lead sources" icon="git-branch-outline">
            {m.sources.length === 0 ? (
              <Text className="font-sans text-sm text-zinc-400">No leads or wins in this period.</Text>
            ) : (
              m.sources.map((s) => (
                <View key={s.source} className="border-b border-surface-border py-2">
                  <Text className="font-sans-semibold text-sm text-white">{s.source}</Text>
                  <Text className="mt-0.5 font-sans text-xs text-zinc-400">
                    {s.leads} leads · {s.won} won · {money(s.revenue)} · {s.conversionRate == null ? '—' : `${s.conversionRate}%`}
                  </Text>
                </View>
              ))
            )}
          </Card>

          {/* Follow-ups */}
          <Card title="Follow-ups" icon="alarm-outline">
            <Row label="Due this period" value={m.followUps.due} />
            <Row label="Completed" value={m.followUps.completed} />
            <Row label="Missed (not completed)" value={m.followUps.missed} />
            {!r.period.complete && <Row label="Still upcoming" value={m.followUps.upcoming} />}
            <Row label="Completion rate" value={m.followUps.completionRate == null ? '—' : `${m.followUps.completionRate}%`} />
            <Text className="mb-1 mt-3 font-sans-bold text-xs uppercase tracking-wider text-zinc-500">Right now</Text>
            <Row label="Overdue follow-ups" value={r.attention.overdueTasks} />
            <Row label={`Not contacted for ${r.attention.staleDays}+ days`} value={r.attention.leadsNotContacted} />
          </Card>

          {/* Calls */}
          <Card title="Calls" icon="call-outline">
            {m.calls.measured ? (
              <>
                <Row label="Calls received" value={m.calls.received} />
                <Row label="Known callers" value={m.calls.knownCallers} />
                <Row label="Unknown callers" value={m.calls.unknownCallers} />
                <Row label="Saved as leads" value={m.calls.savedAsLeads} />
                <Row label="Linked to existing leads" value={m.calls.linkedToExisting} />
                <Row label="Dismissed" value={m.calls.dismissed} />
                <Row label="Won from calls" value={m.calls.wonFromCalls} />
                <Row label="Revenue from call leads" value={money(m.calls.revenueFromCalls)} />
              </>
            ) : (
              <Text className="font-sans text-sm text-zinc-400">Not measured — connect a call-tracking number to see call stats.</Text>
            )}
          </Card>

          {/* Pipeline */}
          <Card title="Open pipeline (right now)" icon="layers-outline">
            <Row label="Open" value={r.pipeline.open} />
            <Row label="Active" value={r.pipeline.active} />
            <Row label="Total" value={r.pipeline.total} />
          </Card>

          {/* Highlights */}
          {r.highlights.length > 0 && (
            <Card title="Highlights" icon="sparkles-outline">
              {r.highlights.map((h) => <Text key={h} className="mb-1 font-sans text-sm text-zinc-200">• {h}</Text>)}
            </Card>
          )}

          <Text className="mt-2 text-center font-sans text-xs text-zinc-500">{r.footer}</Text>
        </ScrollView>
      )}
    </Screen>
  );
}
