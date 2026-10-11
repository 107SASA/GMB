import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { fetchGbpMedia } from '@/api/endpoints/gbp';
import { useBusiness } from '@/business/BusinessContext';
import { Skeleton } from '@/components/ui';
import { photoQuota } from '@/lib/photo-quota';
import { useTheme } from '@/lib/theme';

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

  // Counted by when each photo was really added (see lib/photo-quota.ts).
  const { photosLeft, isActive } = photoQuota(media.data?.media ?? []);

  return (
    <View className="mx-4 mt-8">
      <View className="rounded-card border border-surface-border bg-surface-raised p-4">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: `${t.brandBright}26` }}>
              <Ionicons name="sparkles" size={20} color={t.brandBright} />
            </View>
            <Text className="font-display-bold text-base text-white" numberOfLines={1} style={{ flexShrink: 1 }}>
              GrowwMatics AI Agent
            </Text>
          </View>
          <View
            style={{ flexShrink: 0, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: isActive ? `${t.emerald}26` : `${t.rose}26` }}
          >
            <Text
              numberOfLines={1}
              textBreakStrategy="simple"
              style={{ fontFamily: 'Inter_700Bold', fontSize: 12, lineHeight: 16, color: isActive ? t.emerald : t.rose }}
            >
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
            onPress={() => router.push('/posts?tab=photos')}
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
