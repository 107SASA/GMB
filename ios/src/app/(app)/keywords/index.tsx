import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchKeywords, setKeywordPinned, type KeywordRow, type KeywordsData } from '@/api/endpoints/keywords';
import { KeywordCard } from '@/components/keywords/keyword-card';
import { useBusiness } from '@/business/BusinessContext';
import { BackChevron, Card, Chip, EmptyState, Screen, SecondaryButton, Skeleton, useInfoSheet } from '@/components/ui';
import { useTheme, withAlpha } from '@/lib/theme';

/**
 * Keywords — the app's version of the website's SEO Plan → Keywords tab
 * (src/components/seo/KeywordsPanel.tsx), from the same /api/keywords data:
 * the owner's keywords, this month's focus + monthly targets, competitors per
 * keyword with gaps, and Google Business Profile customer searches. Cards
 * instead of tables so nothing scrolls sideways on a phone.
 */

const MAX_WIDTH = 640;
const TABS = [
  { id: 'yours', label: 'Your keywords' },
  { id: 'targets', label: 'Targets' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'searches', label: 'Customer searches' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function CompetitorCard({ row }: { row: KeywordRow }) {
  return (
    <Card className="gap-2.5">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="font-sans-semibold text-[15px] text-white">{row.keyword}</Text>
          <Text className="font-sans text-xs text-zinc-500">{row.volumeText}</Text>
        </View>
        <View className="items-end">
          <Text className="font-sans text-[11px] uppercase tracking-[0.6px] text-zinc-500">You</Text>
          <Text className="font-display-bold text-base text-white">{row.rankText}</Text>
        </View>
      </View>
      {row.competitorsAbove.length === 0 ? (
        <Text className="font-sans text-xs text-zinc-500">No business was seen above you.</Text>
      ) : (
        row.competitorsAbove.map((c, i) => (
          <View key={`${c.name}-${i}`} className="flex-row items-center gap-2">
            <Text className="w-7 font-sans-semibold text-xs text-zinc-500">#{c.rank}</Text>
            <Text className="flex-1 font-sans text-sm text-zinc-300" numberOfLines={1}>{c.name}</Text>
            <Text className="font-sans text-xs text-zinc-500">
              {[c.rating != null ? `${c.rating}★` : null, c.reviews != null ? `${c.reviews.toLocaleString('en-IN')} reviews` : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ))
      )}
    </Card>
  );
}

function SummaryStrip({ research }: { research: NonNullable<KeywordsData['research']> }) {
  const date = research.ranAt ? new Date(research.ranAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
  const items = [
    { label: 'Researched', value: research.candidates.toLocaleString('en-IN') },
    { label: 'With Google data', value: research.withVolume.toLocaleString('en-IN') },
    { label: 'Rank checked', value: research.rankChecked.toLocaleString('en-IN') },
    { label: 'Last checked', value: date },
  ];
  return (
    <View className="flex-row flex-wrap gap-2">
      {items.map((s) => (
        <View key={s.label} className="min-w-[46%] flex-1 rounded-card border border-surface-border bg-surface-raised px-3 py-2.5">
          <Text className="font-display-bold text-lg text-white">{s.value}</Text>
          <Text className="font-sans text-xs text-zinc-500">{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

export default function KeywordsScreen() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<TabId>(TABS.some((x) => x.id === params.tab) ? (params.tab as TabId) : 'yours');
  const info = useInfoSheet();
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/more'));

  const query = useQuery({
    queryKey: ['keywords', activeBusinessId],
    queryFn: fetchKeywords,
    enabled: !!activeBusinessId,
  });

  const [pinningId, setPinningId] = useState<string | null>(null);
  const pin = useMutation({
    mutationFn: (row: KeywordRow) => setKeywordPinned(row.id, !row.pinned),
    onMutate: (row) => setPinningId(row.id),
    onSuccess: (pinned, row) => {
      info.show(
        pinned ? 'Pinned' : 'Unpinned',
        pinned ? `"${row.keyword}" stays a focus keyword from your next report.` : `"${row.keyword}" is back to automatic selection.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['keywords', activeBusinessId] });
    },
    onError: (err) => info.show("Couldn't update", getApiErrorMessage(err, 'Please try again.')),
    onSettled: () => setPinningId(null),
  });

  const header = (
    <View className="border-b border-surface-border">
      <View className="flex-row items-center gap-3 px-4 pb-3 pt-2" style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' }}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={{ minHeight: 40, justifyContent: 'center' }}>
          <BackChevron />
        </Pressable>
        <Text className="flex-1 font-display-bold text-lg text-white" numberOfLines={1} accessibilityRole="header">
          Keywords
        </Text>
        {query.isFetching && !query.isLoading && <ActivityIndicator size="small" color={t.brandBright} />}
      </View>
    </View>
  );

  if (query.isLoading || !activeBusinessId) {
    return (
      <Screen>
        {header}
        <View className="gap-3 px-4 pt-4" style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' }}>
          <Skeleton className="h-20" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </View>
      </Screen>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Screen>
        {header}
        <EmptyState
          title="Couldn't load keywords"
          hint={getApiErrorMessage(query.error, 'Check your connection and try again.')}
          action={<View className="mt-2"><SecondaryButton title="Try again" onPress={() => void query.refetch()} /></View>}
        />
      </Screen>
    );
  }

  const data = query.data;
  const empty = (title: string, hint: string) => (
    <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-5">
      <Text className="font-sans-semibold text-sm text-white">{title}</Text>
      <Text className="mt-1 font-sans text-xs leading-5 text-zinc-400">{hint}</Text>
    </View>
  );

  return (
    <Screen>
      {header}
      <ScrollView
        contentContainerClassName="gap-4 px-4 pb-16 pt-4"
        contentContainerStyle={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={t.brandBright} colors={[t.brand]} />}
      >
        <Text className="font-sans text-sm leading-5 text-zinc-400">
          What people search on Google, how many search it each month, where you rank on Google Maps and who is above you. Your focus keywords are picked every month from these numbers.
        </Text>

        {data.research && <SummaryStrip research={data.research} />}

        {!data.hasResearch && (
          <View className="flex-row gap-3 rounded-card px-4 py-3.5" style={{ backgroundColor: withAlpha(t.brand, 0.12) }}>
            <Ionicons name="time-outline" size={20} color={t.brandBright} />
            <Text className="flex-1 font-sans text-sm leading-5 text-zinc-300">
              {data.googleConnected
                ? 'Your keywords are researched in your next full report — search volume, your Google Maps rank and the businesses above you. Nothing to do.'
                : 'Connect your Google Business Profile to start. Your first full report then researches your keywords automatically.'}
            </Text>
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {TABS.map((x) => (
            <Chip key={x.id} label={x.label} selected={tab === x.id} onPress={() => setTab(x.id)} />
          ))}
        </ScrollView>

        {tab === 'yours' && (
          <View className="gap-3">
            <Pressable onPress={() => router.push('/settings')} accessibilityRole="link" className="flex-row items-center gap-1.5">
              <Ionicons name="create-outline" size={14} color={t.brandBright} />
              <Text className="font-sans-semibold text-xs" style={{ color: t.brandBright }}>Add or remove your keywords</Text>
            </Pressable>
            {data.yours.length === 0
              ? empty('No keywords added yet', 'Add up to 20 keywords in Settings. We also research hundreds more for you every month.')
              : data.yours.map((row) => (
                  <KeywordCard key={row.id} row={row} showRole onPin={(r) => pin.mutate(r)} pinning={pinningId === row.id} />
                ))}
          </View>
        )}

        {tab === 'targets' && (
          <View className="gap-3">
            {data.targets.length === 0
              ? empty('Targets are picked in your next full report', 'We choose 5 focus keywords (kept at least 90 days) and 5 keywords for this month, from real search and ranking data.')
              : (
                <>
                  <Text className="font-sans text-xs leading-5 text-zinc-500">
                    Focus keywords stay at least 90 days so rankings have time to move; “This month” keywords change monthly. Tap the pin to keep one.
                  </Text>
                  {data.targets.map((row) => (
                    <KeywordCard key={row.id} row={row} showRole={false} onPin={(r) => pin.mutate(r)} pinning={pinningId === row.id} />
                  ))}
                </>
              )}
          </View>
        )}

        {tab === 'competitors' && (
          <View className="gap-3">
            {data.competitors.length === 0
              ? empty('No competitor data yet', 'Your next full report shows who ranks above you for each target keyword.')
              : data.competitors.map((row) => <CompetitorCard key={row.id} row={row} />)}
            <Text className="mt-2 font-sans-semibold text-sm text-white">Competitors rank, you don’t</Text>
            <Text className="font-sans text-xs leading-5 text-zinc-500">A competitor is in the top 3 (or its website ranks) and you are not in the top 20.</Text>
            {data.gaps.length === 0 ? (
              <Text className="font-sans text-xs text-zinc-500">None found in the last report.</Text>
            ) : (
              data.gaps.map((g) => (
                <Card key={g.keyword} className="gap-1">
                  <View className="flex-row items-start justify-between gap-3">
                    <Text className="flex-1 font-sans-semibold text-sm text-white">{g.keyword}</Text>
                    <Text className="font-sans text-xs text-zinc-400">{g.volumeText}</Text>
                  </View>
                  <Text className="font-sans text-xs text-zinc-400">
                    {g.competitor}{g.competitorRank != null ? ` is #${g.competitorRank} on Google Maps` : '’s website ranks for this'}
                  </Text>
                </Card>
              ))
            )}
          </View>
        )}

        {tab === 'searches' && (
          <View className="gap-3">
            {data.searchTerms.length === 0
              ? empty('No customer searches yet', 'Google reports the searches that showed your profile once a month, after your profile is connected.')
              : (
                <Card className="gap-0">
                  <Text className="mb-2 font-sans text-xs leading-5 text-zinc-500">
                    What customers typed when Google showed your profile{data.searchTermsMonth ? ` (${data.searchTermsMonth})` : ''}.
                  </Text>
                  {data.searchTerms.map((s, i) => (
                    <View key={s.keyword} className={`flex-row items-center justify-between gap-3 py-2.5 ${i ? 'border-t border-surface-border' : ''}`}>
                      <Text className="flex-1 font-sans text-sm text-zinc-300">{s.keyword}</Text>
                      <Text className="font-sans-semibold text-sm text-white">{s.impressions.toLocaleString('en-IN')}</Text>
                    </View>
                  ))}
                </Card>
              )}
          </View>
        )}
      </ScrollView>
      {info.node}
    </Screen>
  );
}
