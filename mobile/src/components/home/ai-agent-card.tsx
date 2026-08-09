import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { fetchGbpMedia } from '@/api/endpoints/gbp';
import { useBusiness } from '@/business/BusinessContext';
import { Skeleton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * Weekly photo cadence that keeps a profile "fresh" — a real, if simple,
 * content-marketing recommendation (a handful of new photos/week keeps a
 * listing looking active to both Google and visitors), not an arbitrary
 * number. Same idea as WEEKLY_REVIEW_GOAL in lib/review-insights.ts; make
 * this owner-configurable later if the product wants per-business tiers.
 */
const WEEKLY_PHOTO_QUOTA = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "AI Agent" photo-quota card — real computation from GbpMediaAsset upload
 * timestamps (already fetched for the Photos tab), not a placeholder. A
 * business counts as "active" if it uploaded at least one photo this week
 * OR last week (one week's grace before the badge flips); "photos left"
 * counts uploads (staged or published — the quota is about the owner
 * adding content, not about it having gone live yet) against the weekly
 * quota above.
 */
export function AiAgentCard() {
  const { activeBusinessId } = useBusiness();
  const router = useRouter();
  const t = useTheme();

  const media = useQuery({
    queryKey: ['gbp-media', activeBusinessId],
    queryFn: fetchGbpMedia,
    enabled: !!activeBusinessId,
    retry: false,
  });

  if (media.isLoading) return <Skeleton className="mx-4 mt-8 h-40 rounded-card" />;
  if (media.isError) return null; // Not connected — the Photos tab already explains why; no need to repeat it here.

  const now = Date.now();
  const items = media.data?.media ?? [];
  const usedThisWeek = items.filter((m) => m.createdAt && now - new Date(m.createdAt).getTime() < 7 * DAY_MS).length;
  const usedLastWeek = items.filter((m) => {
    if (!m.createdAt) return false;
    const age = now - new Date(m.createdAt).getTime();
    return age >= 7 * DAY_MS && age < 14 * DAY_MS;
  }).length;

  const photosLeft = Math.max(0, WEEKLY_PHOTO_QUOTA - usedThisWeek);
  const isActive = usedThisWeek > 0 || usedLastWeek > 0;

  return (
    <View className="mx-4 mt-8">
      <View className="rounded-card border border-surface-border bg-surface-raised p-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: `${t.brandBright}26` }}>
              <Ionicons name="sparkles" size={20} color={t.brandBright} />
            </View>
            <Text className="font-display-bold text-base text-white">GrowwMatics AI Agent</Text>
          </View>
          <View
            className="rounded-full px-3 py-1"
            style={{ backgroundColor: isActive ? `${t.emerald}26` : `${t.rose}26` }}
          >
            <Text className="font-sans-bold text-xs" style={{ color: isActive ? t.emerald : t.rose }}>
              {isActive ? 'Active' : 'Needs Attention'}
            </Text>
          </View>
        </View>

        <View className="mt-4 flex-row items-center justify-between rounded-2xl bg-surface-overlay p-3.5">
          <View className="flex-1 pr-3">
            <Text className="font-sans-bold text-base" style={{ color: photosLeft === 0 ? t.rose : t.text }}>
              {photosLeft} Photo{photosLeft === 1 ? '' : 's'} left
            </Text>
            <Text className="mt-0.5 font-sans text-xs leading-4 text-zinc-500">
              {isActive
                ? 'Profile stays fresh & active for 1 more week'
                : "No photos added in 2 weeks — your profile's freshness signal is slipping"}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/photos')}
            // No `className` — react-native-css-interop can swallow onPress
            // on styled Pressables (see components/ui.tsx).
            style={{ borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: t.brand }}
          >
            <Text className="font-sans-bold text-sm text-on-brand">Add Photos</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
