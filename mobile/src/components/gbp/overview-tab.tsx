import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { fetchGbpInsights } from '@/api/endpoints/dashboard';
import { useBusiness } from '@/business/BusinessContext';
import { ImpactBars } from '@/components/charts';
import { AiActionsCard } from '@/components/gbp/ai-actions';
import { Skeleton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * GBP → Overview: the "AI Impact" before/after card plus the AI Actions feed.
 * "Before" = the profile's current monthly averages; "After" fills in once
 * optimization has been running long enough to compare.
 */
export function OverviewTab() {
  const { activeBusinessId } = useBusiness();
  const t = useTheme();

  const gbp = useQuery({
    queryKey: ['gbp-insights', activeBusinessId],
    queryFn: () => fetchGbpInsights(28),
    enabled: !!activeBusinessId,
  });

  return (
    <View className="px-4">
      <View className="mb-1 flex-row items-center gap-2 pt-2">
        <Ionicons name="logo-google" size={18} color={t.brandBright} />
        <Text className="text-lg font-extrabold text-white">GBP — AI Impact</Text>
      </View>

      {gbp.isLoading ? (
        <Skeleton className="mt-3 h-56" />
      ) : gbp.data?.connected && gbp.data.summary ? (
        <View className="mt-3 flex-row rounded-3xl border border-surface-border bg-surface-raised p-4">
          {/* Before */}
          <View className="flex-1 pr-3">
            <View className="mb-3 self-start rounded-xl bg-surface-overlay px-3 py-1.5">
              <Text className="text-sm font-bold text-zinc-200">Before</Text>
            </View>
            <ImpactBars
              items={[
                { label: 'Views', value: gbp.data.summary.totalViews },
                { label: 'Calls', value: gbp.data.summary.totalCallClicks },
                { label: 'Directions', value: gbp.data.summary.totalDirectionRequests },
              ]}
            />
            <Text className="mt-1 text-center text-xs text-zinc-500">Last 28 days</Text>
          </View>
          {/* After */}
          <View className="w-px bg-surface-border" />
          <View className="flex-1 items-center justify-center pl-3">
            <View className="mb-3 self-center rounded-xl bg-surface-overlay px-3 py-1.5">
              <Text className="text-sm font-bold text-zinc-200">After</Text>
            </View>
            <Text className="mb-2 text-lg">✨</Text>
            <Text className="text-center text-sm leading-5 text-zinc-300">
              Optimization is still in progress
            </Text>
          </View>
        </View>
      ) : (
        <View className="mt-3 rounded-2xl border border-surface-border bg-surface-raised px-4 py-5">
          <Text className="text-sm leading-5 text-zinc-400">
            Google Business Profile is not connected. Connect it from the web dashboard to see
            impact here.
          </Text>
        </View>
      )}

      <AiActionsCard />
    </View>
  );
}
