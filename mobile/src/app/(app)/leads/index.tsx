import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  fetchCalls,
  fetchLeadStages,
  fetchRoi,
  formatMoney,
  groupLabel,
  LIFECYCLE_STAGES,
  type LeadStages,
} from '@/api/endpoints/crm';
import { fetchLeads, type Lead } from '@/api/endpoints/leads';
import { useBusiness } from '@/business/BusinessContext';
import { AppHeader } from '@/components/app-header';
import { Badge, Chip, EmptyState, Field, Screen, Skeleton } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { useTheme } from '@/lib/theme';

function stageLabel(stages: LeadStages | undefined, lead: Lead): string {
  return lead.subStage || groupLabel(stages, lead.lifeCycleStage || 'initial');
}

function LeadCard({ lead, stages }: { lead: Lead; stages: LeadStages | undefined }) {
  const router = useRouter();
  const t = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/leads/${lead._id}`)}
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
          {lead.name}
        </Text>
        {lead.lifeCycleStage === 'converted' && typeof lead.deal?.value === 'number' && (
          <Badge label={formatMoney(lead.deal.value, lead.deal.currency)} tone="positive" />
        )}
      </View>
      <View className="mt-2 flex-row flex-wrap items-center gap-2">
        <Badge label={lead.source} />
        <Badge
          label={stageLabel(stages, lead)}
          tone={lead.lifeCycleStage === 'converted' ? 'positive' : lead.lifeCycleStage === 'closed' ? 'negative' : 'info'}
        />
        <Text className="ml-auto font-sans text-xs text-zinc-500">
          {timeAgo(lead.lastActivityAt)}
        </Text>
      </View>
    </Pressable>
  );
}

function CaptureAction({
  icon,
  label,
  href,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  href: Href;
}) {
  const router = useRouter();
  const t = useTheme();
  return (
    <Pressable
      onPress={() => router.push(href)}
      // No `className` — see note above.
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.card,
        paddingHorizontal: 14,
        paddingVertical: 8,
      }}
    >
      <Ionicons name={icon} size={14} color={t.brandBright} />
      <Text className="font-sans-semibold text-sm text-zinc-200">{label}</Text>
    </Pressable>
  );
}

export default function LeadsScreen() {
  const { activeBusinessId } = useBusiness();
  const t = useTheme();
  const router = useRouter();
  const [search, setSearch] = useState('');
  // 'all' | lifecycle group; subFilter narrows to one sub-stage of that group.
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [subFilter, setSubFilter] = useState<string | null>(null);

  const leads = useQuery({
    queryKey: ['crm-leads', activeBusinessId],
    queryFn: fetchLeads,
    enabled: !!activeBusinessId,
  });
  const stagesQuery = useQuery({
    queryKey: ['lead-stages', activeBusinessId],
    queryFn: fetchLeadStages,
    enabled: !!activeBusinessId,
  });
  const stages = stagesQuery.data;
  // Calls from the business's tracking number that aren't saved as leads yet.
  const pendingCalls = useQuery({
    queryKey: ['crm-calls-pending', activeBusinessId],
    queryFn: () => fetchCalls(true),
    enabled: !!activeBusinessId,
  });
  const roi = useQuery({
    queryKey: ['crm-roi', activeBusinessId, 30],
    queryFn: () => fetchRoi(30),
    enabled: !!activeBusinessId,
  });

  const subOptions =
    stages && stageFilter !== 'all' && stageFilter !== 'initial'
      ? stages[stageFilter as 'active' | 'converted' | 'closed'] ?? []
      : [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (leads.data ?? []).filter((lead) => {
      const group = lead.lifeCycleStage || 'initial';
      if (stageFilter !== 'all' && group !== stageFilter) return false;
      if (subFilter) {
        const sub = subOptions.find((s) => s.id === subFilter);
        const match = lead.subStageId ? lead.subStageId === subFilter : !!sub && lead.subStage === sub.name;
        if (!match) return false;
      }
      if (!q) return true;
      return [lead.name, lead.phone, lead.email, lead.interest]
        .filter((v): v is string => !!v)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [leads.data, search, stageFilter, subFilter, subOptions]);

  return (
    <Screen>
      <AppHeader title="CRM" />

      {/* Capture actions (Phase 4B) */}
      <View className="pb-3">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 px-5"
        >
          <CaptureAction icon="add" label="Add lead" href="/leads/add" />
          <CaptureAction icon="call-outline" label="Log a call" href="/leads/add?intent=call" />
          <CaptureAction icon="people-outline" label="From contacts" href="/leads/import-contacts" />
          {/* Calls reported by the business's call-tracking provider (server
              side — works on iOS and Android; no call-log permission). */}
          <CaptureAction icon="time-outline" label="Calls" href="/leads/recent-calls" />
        </ScrollView>
      </View>

      {(pendingCalls.data?.pendingCount ?? 0) > 0 && (
        <Pressable
          onPress={() => router.push('/leads/recent-calls')}
          style={{
            marginHorizontal: 20,
            marginBottom: 12,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: t.brand,
            backgroundColor: t.card,
            paddingHorizontal: 16,
            paddingVertical: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Ionicons name="call-outline" size={18} color={t.brandBright} />
          <Text className="flex-1 font-sans-semibold text-sm text-zinc-200">
            {pendingCalls.data!.pendingCount} call{pendingCalls.data!.pendingCount === 1 ? '' : 's'} not saved as a lead
          </Text>
          <Text className="font-sans-semibold text-sm text-indigo-300">Review</Text>
        </Pressable>
      )}

      {!!roi.data && (
        <View className="mx-5 mb-3 rounded-card border border-surface-border bg-surface-raised px-4 py-3">
          <Text className="font-sans-bold text-[11px] uppercase tracking-[0.6px] text-zinc-500">Last 30 days</Text>
          <View className="mt-1 flex-row flex-wrap gap-x-4 gap-y-1">
            <Text className="font-sans text-sm text-zinc-300">{roi.data.roi.totalLeads} leads</Text>
            <Text className="font-sans text-sm text-zinc-300">
              {roi.data.roi.convertedLeads} won
              {roi.data.roi.conversionRate != null ? ` (${roi.data.roi.conversionRate}%)` : ''}
            </Text>
            <Text className="font-sans-semibold text-sm text-white">
              {formatMoney(roi.data.roi.wonRevenue, roi.data.roi.currency)} revenue
            </Text>
          </View>
          <Text className="mt-1 font-sans text-xs text-zinc-500">
            {roi.data.roi.roiPercent != null ? `ROI ${roi.data.roi.roiPercent}%` : roi.data.roi.roiNote || ''}
          </Text>
        </View>
      )}

      {/* Monthly Growth Report (same numbers as the web report) */}
      <Pressable
        onPress={() => router.push('/leads/growth-report')}
        style={{
          marginHorizontal: 20,
          marginBottom: 12,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.card,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Ionicons name="stats-chart-outline" size={18} color={t.brandBright} />
        <View className="flex-1">
          <Text className="font-sans-semibold text-sm text-zinc-200">Monthly Growth</Text>
          <Text className="font-sans text-xs text-zinc-500">See your monthly CRM performance</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={t.textFaint} />
      </Pressable>

      <View className="px-5 pb-3">
        <Field
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, phone, email…"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View className="pb-3">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 px-5"
        >
          {['all', ...LIFECYCLE_STAGES].map((stage) => (
            <Chip
              key={stage}
              label={stage === 'all' ? 'All' : groupLabel(stages, stage)}
              selected={stageFilter === stage}
              onPress={() => {
                setStageFilter(stage);
                setSubFilter(null);
              }}
            />
          ))}
        </ScrollView>
        {subOptions.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2 px-5 pt-2"
          >
            {subOptions.map((sub) => (
              <Chip
                key={sub.id ?? sub.name}
                label={sub.name}
                selected={subFilter === sub.id}
                onPress={() => setSubFilter(subFilter === sub.id ? null : sub.id ?? null)}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {leads.isLoading ? (
        <View className="gap-3 px-5">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </View>
      ) : leads.isError ? (
        <EmptyState
          title="Couldn't load leads"
          hint={getApiErrorMessage(leads.error, 'Pull down to retry.')}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(l) => l._id}
          renderItem={({ item }) => <LeadCard lead={item} stages={stages} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={leads.isRefetching}
              onRefresh={() => {
                void leads.refetch();
                void pendingCalls.refetch();
                void roi.refetch();
              }}
              tintColor={t.brandBright}
            />
          }
          ListEmptyComponent={
            <EmptyState
              title={search || stageFilter !== 'all' ? 'No matching leads' : 'No leads yet'}
              hint={
                search || stageFilter !== 'all'
                  ? 'Try a different search or stage filter.'
                  : 'New leads from WhatsApp, your website and Google will appear here.'
              }
            />
          }
          keyboardShouldPersistTaps="handled"
        />
      )}
    </Screen>
  );
}
