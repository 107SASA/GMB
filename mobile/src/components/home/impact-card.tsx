import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { fetchGbpInsights } from '@/api/endpoints/dashboard';
import { useBusiness } from '@/business/BusinessContext';
import { BeforeAfterBars } from '@/components/charts';
import { GoogleG } from '@/components/google-g';
import { Skeleton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

function SectionHeader() {
  return (
    <View className="mb-3 flex-row items-center gap-2">
      <GoogleG size={18} />
      <Text className="font-display-bold text-lg text-white">GBP — AI Impact</Text>
    </View>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <View className="mx-4 mt-8">
      <SectionHeader />
      <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-5">
        <Text className="font-sans text-sm leading-5 text-zinc-400">{text}</Text>
      </View>
    </View>
  );
}

/**
 * "GBP - AI Impact" — real Views/Calls/Directions before vs. after this
 * business connected Google (GBPToken.connectedAt), not a fixed lookback
 * window and not a placeholder "optimization in progress" message (that was
 * the previous GBP-hub Overview tab's behavior — see gbp/overview-tab.tsx).
 * Numbers come straight from /api/gbp/insights' new `impact` field, which
 * itself is null on either side rather than a fabricated 0 when there
 * genuinely isn't data yet for that period.
 */
export function ImpactCard() {
  const { activeBusinessId } = useBusiness();
  const router = useRouter();
  const t = useTheme();

  const gbp = useQuery({
    queryKey: ['gbp-insights', activeBusinessId],
    queryFn: () => fetchGbpInsights(28),
    enabled: !!activeBusinessId,
  });

  if (gbp.isLoading) return <Skeleton className="mx-4 mt-8 h-56 rounded-card" />;

  if (!gbp.data?.connected) {
    return <EmptyCard text="Connect your Google Business Profile to see your before/after impact." />;
  }

  const impact = gbp.data.impact;
  if (!impact || impact.before.days === 0) {
    return (
      <EmptyCard text="Not enough history from before you connected Google yet to show a real before/after comparison — check back once more data has synced." />
    );
  }

  return (
    <View className="mx-4 mt-8">
      <SectionHeader />
      <View className="rounded-card border border-surface-border bg-surface-raised p-4">
        <BeforeAfterBars
          metrics={[
            { label: 'Views', before: impact.before.views, after: impact.after.views },
            { label: 'Calls', before: impact.before.callClicks, after: impact.after.callClicks },
            { label: 'Directions', before: impact.before.directionRequests, after: impact.after.directionRequests },
          ]}
        />
        {impact.after.days === 0 && (
          <Text className="mt-3 text-center font-sans text-xs text-zinc-500">
            "After" is still gathering data since you connected — check back soon.
          </Text>
        )}
        <Pressable
          // Cast: expo-router's generated route types haven't been
          // regenerated to include the new /performance tab yet (that
          // happens on next `expo start`) — matches the same cast in
          // components/home/stat-list.tsx for the same reason.
          onPress={() => router.push('/performance' as never)}
          // No `className` — see note above.
          style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}
        >
          <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
            View Performance Report
          </Text>
          <Ionicons name="chevron-forward" size={14} color={t.brandBright} />
        </Pressable>
      </View>
    </View>
  );
}
