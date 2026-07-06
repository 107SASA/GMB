import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchAudits, type AuditListItem } from '@/api/endpoints/audit';
import { useBusiness } from '@/business/BusinessContext';
import { Badge, EmptyState, Screen, ScreenTitle, Skeleton } from '@/components/ui';
import { timeAgo } from '@/lib/format';

function ScoreRing({ score }: { score: number | null }) {
  const color =
    score === null
      ? 'border-zinc-700'
      : score >= 70
        ? 'border-emerald-500'
        : score >= 40
          ? 'border-amber-500'
          : 'border-rose-400';
  return (
    <View className={`h-12 w-12 items-center justify-center rounded-full border-2 ${color}`}>
      <Text className="text-sm font-bold text-white">{score ?? '—'}</Text>
    </View>
  );
}

function AuditCard({ audit }: { audit: AuditListItem }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/audit/${audit._id}`)}
      className="mb-3 flex-row items-center gap-3 rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5 active:opacity-80"
    >
      <ScoreRing score={audit.status === 'COMPLETED' ? audit.overallScore : null} />
      <View className="flex-1">
        <Text className="text-base font-semibold text-white" numberOfLines={1}>
          {audit.businessName}
        </Text>
        <Text className="mt-0.5 text-xs text-zinc-500">{timeAgo(audit.createdAt)}</Text>
      </View>
      {audit.status === 'PENDING' && <Badge label="Running" tone="info" />}
      {audit.status === 'FAILED' && <Badge label="Failed" tone="negative" />}
      <Ionicons name="chevron-forward" size={16} color="#4A5175" />
    </Pressable>
  );
}

export default function AuditListScreen() {
  const { activeBusinessId } = useBusiness();
  const router = useRouter();

  // The list is tenant-scoped server-side (same as web) — the key still
  // includes the business id so a workspace switch refreshes it.
  const audits = useQuery({
    queryKey: ['audits', activeBusinessId],
    queryFn: fetchAudits,
    enabled: !!activeBusinessId,
  });

  return (
    <Screen>
      <View className="flex-row items-center justify-between pr-5">
        <ScreenTitle>Audit Engine</ScreenTitle>
        <Pressable
          onPress={() => router.push('/audit/run')}
          className="flex-row items-center gap-1.5 rounded-full bg-brand px-4 py-2 active:opacity-80"
        >
          <Ionicons name="flash" size={14} color="#ffffff" />
          <Text className="text-sm font-semibold text-on-brand">Run audit</Text>
        </Pressable>
      </View>

      {audits.isLoading ? (
        <View className="mt-3 gap-3 px-5">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </View>
      ) : audits.isError ? (
        <EmptyState
          title="Couldn't load audits"
          hint={getApiErrorMessage(audits.error, 'Pull down to retry.')}
        />
      ) : (
        <FlatList
          data={audits.data}
          keyExtractor={(a) => a._id}
          renderItem={({ item }) => <AuditCard audit={item} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={audits.isRefetching}
              onRefresh={() => void audits.refetch()}
              tintColor="#6366F1"
            />
          }
          ListEmptyComponent={
            <EmptyState
              title="No audits yet"
              hint="Run your first audit to see how your business ranks on Google."
            />
          }
        />
      )}
    </Screen>
  );
}
