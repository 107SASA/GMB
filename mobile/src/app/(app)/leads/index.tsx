import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchKanbanColumns, fetchLeads, type Lead } from '@/api/endpoints/leads';
import { useBusiness } from '@/business/BusinessContext';
import { AppHeader } from '@/components/app-header';
import { Badge, Chip, EmptyState, Field, Screen, Skeleton } from '@/components/ui';
import { useMobileFlags } from '@/lib/featureFlags';
import { timeAgo } from '@/lib/format';

const UNASSIGNED = 'Unassigned';

function scoreTone(score: number): 'positive' | 'warning' | 'neutral' {
  if (score >= 70) return 'positive';
  if (score >= 40) return 'warning';
  return 'neutral';
}

function LeadCard({ lead }: { lead: Lead }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/leads/${lead._id}`)}
      className="mb-3 rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5 active:opacity-80"
    >
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-base font-semibold text-white" numberOfLines={1}>
          {lead.name}
        </Text>
        {lead.aiLeadScore != null && (
          <Badge label={`Score ${lead.aiLeadScore}`} tone={scoreTone(lead.aiLeadScore)} />
        )}
      </View>
      <View className="mt-2 flex-row flex-wrap items-center gap-2">
        <Badge label={lead.source} />
        <Badge label={lead.pipelineStage || UNASSIGNED} tone="info" />
        <Text className="ml-auto text-xs text-zinc-500">{timeAgo(lead.lastActivityAt)}</Text>
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
  return (
    <Pressable
      onPress={() => router.push(href)}
      className="flex-row items-center gap-1.5 rounded-full border border-surface-border bg-surface-raised px-3.5 py-2 active:opacity-70"
    >
      <Ionicons name={icon} size={14} color="#6366F1" />
      <Text className="text-sm font-medium text-zinc-200">{label}</Text>
    </Pressable>
  );
}

export default function LeadsScreen() {
  const { activeBusinessId } = useBusiness();
  const flags = useMobileFlags();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');

  const leads = useQuery({
    queryKey: ['crm-leads', activeBusinessId],
    queryFn: fetchLeads,
    enabled: !!activeBusinessId,
  });
  const columns = useQuery({
    queryKey: ['kanban-columns', activeBusinessId],
    queryFn: fetchKanbanColumns,
    enabled: !!activeBusinessId,
  });

  // Filter chips: the business's Kanban columns plus Unassigned (null stage).
  const stages = useMemo(() => {
    const fromColumns = columns.data ?? [];
    const fromLeads = (leads.data ?? [])
      .map((l) => l.pipelineStage)
      .filter((s): s is string => !!s && !fromColumns.includes(s));
    return ['all', ...fromColumns, ...Array.from(new Set(fromLeads)), UNASSIGNED];
  }, [columns.data, leads.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (leads.data ?? []).filter((lead) => {
      const stage = lead.pipelineStage || UNASSIGNED;
      if (stageFilter !== 'all' && stage !== stageFilter) return false;
      if (!q) return true;
      return [lead.name, lead.phone, lead.email, lead.interest]
        .filter((v): v is string => !!v)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [leads.data, search, stageFilter]);

  return (
    <Screen>
      <AppHeader title="All Contacts" />

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
          {/* Plan B: remote-flagged AND Android-only. iOS has no call-log
              access at all — never show this there. */}
          {Platform.OS === 'android' && flags.androidCallLogCapture && (
            <CaptureAction icon="time-outline" label="Recent calls" href="/leads/recent-calls" />
          )}
        </ScrollView>
      </View>

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
          {stages.map((stage) => (
            <Chip
              key={stage}
              label={stage === 'all' ? 'All' : stage}
              selected={stageFilter === stage}
              onPress={() => setStageFilter(stage)}
            />
          ))}
        </ScrollView>
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
          renderItem={({ item }) => <LeadCard lead={item} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={leads.isRefetching}
              onRefresh={() => void leads.refetch()}
              tintColor="#6366F1"
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
