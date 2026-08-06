import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchAudits, type AuditListItem } from '@/api/endpoints/audit';
import { useBusiness } from '@/business/BusinessContext';
import { Badge, EmptyState, Screen, ScreenTitle, Skeleton } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/** Score ring — semantic score-color rule: ≥70 green, 40-69 amber, <40 rose. */
function ScoreRing({ score }: { score: number | null }) {
  const color =
    score === null
      ? 'border-zinc-700'
      : score >= 70
        ? 'border-secondary'
        : score >= 40
          ? 'border-warning'
          : 'border-error';
  return (
    <View className={`h-12 w-12 items-center justify-center rounded-full border-2 ${color}`}>
      <Text className="font-sans-bold text-sm text-white">{score ?? '—'}</Text>
    </View>
  );
}

function AuditCard({ audit }: { audit: AuditListItem }) {
  const router = useRouter();
  const t = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/audit/${audit._id}`)}
      // No `className` — react-native-css-interop can swallow onPress on
      // styled Pressables (see components/ui.tsx).
      style={{
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.card,
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      <ScoreRing score={audit.status === 'COMPLETED' ? audit.overallScore : null} />
      <View className="flex-1">
        <Text className="font-sans-semibold text-base text-white" numberOfLines={1}>
          {audit.businessName}
        </Text>
        <Text className="mt-0.5 font-sans text-xs text-zinc-500">{timeAgo(audit.createdAt)}</Text>
      </View>
      {audit.status === 'PENDING' && <Badge label="Running" tone="info" />}
      {audit.status === 'FAILED' && <Badge label="Failed" tone="negative" />}
      <Ionicons name="chevron-forward" size={16} color={t.textFaint} />
    </Pressable>
  );
}

export default function AuditListScreen() {
  const { activeBusinessId } = useBusiness();
  const router = useRouter();
  const t = useTheme();

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
          // No `className` — see note above.
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: t.brand, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <Ionicons name="flash" size={14} color="#ffffff" />
          <Text className="font-sans-bold text-sm text-on-brand">Run audit</Text>
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
              tintColor={t.brandBright}
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
