import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { fetchBuffer } from '@/api/endpoints/scheduler';
import { useBusiness } from '@/business/BusinessContext';
import { useLatestAudit } from '@/components/gbp/use-latest-audit';
import { useTheme } from '@/lib/theme';

function shortDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * "AI Actions" feed card — what the platform has recently done for this
 * business (latest completed audit + content pipeline status), in the
 * reference app's "Profile Updated" card style.
 */
export function AiActionsCard({ showViewAll = true }: { showViewAll?: boolean }) {
  const { activeBusinessId } = useBusiness();
  const router = useRouter();
  const t = useTheme();
  const { audit } = useLatestAudit();

  const buffer = useQuery({
    queryKey: ['scheduler-buffer', activeBusinessId],
    queryFn: fetchBuffer,
    enabled: !!activeBusinessId,
  });

  const publishedPosts = (buffer.data?.allPosts ?? []).filter((p) => p.status === 'published');
  const latestPublished = publishedPosts[0] ?? null;

  const actions: { badge: string; date: string; title: string; bullets: string[] }[] = [];

  if (audit) {
    const fixes = audit.auditData?.priorityFixes?.length ?? 0;
    const wins = audit.auditData?.quickWins?.length ?? 0;
    actions.push({
      badge: 'Profile Audited',
      date: shortDate(audit.createdAt),
      title: 'Your Google Business Profile: audited to attract more customers',
      bullets: [
        audit.overallScore != null ? `Overall score ${audit.overallScore}/100` : 'Audit completed',
        ...(fixes ? [`${fixes} priority fixes identified`] : []),
        ...(wins ? [`${wins} quick wins suggested`] : []),
      ],
    });
  }
  if (latestPublished) {
    actions.push({
      badge: 'Post Published',
      date: shortDate(latestPublished.publishedAt ?? latestPublished.createdAt),
      title: latestPublished.title || 'New post published to your profile',
      bullets: ['Published to Google Business Profile'],
    });
  }

  return (
    <View className="mt-6 pb-2">
      <View className="mb-3 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Text className="text-base">✨</Text>
          <Text className="text-lg font-extrabold text-white">AI Actions</Text>
        </View>
        {showViewAll && (
          <Pressable
            onPress={() => router.push('/audit')}
            className="flex-row items-center gap-1 active:opacity-70"
          >
            <Text className="text-sm font-bold" style={{ color: t.brandBright }}>
              View All
            </Text>
            <Ionicons name="chevron-forward" size={14} color={t.brandBright} />
          </Pressable>
        )}
      </View>

      {actions.length === 0 ? (
        <View className="rounded-2xl border border-surface-border bg-surface-raised px-4 py-6">
          <Text className="text-sm leading-5 text-zinc-400">
            No AI actions yet — run an audit or schedule posts and the work done for your profile
            shows up here.
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {actions.map((action) => (
            <View
              key={action.badge + action.title}
              className="rounded-3xl border border-surface-border bg-surface-raised p-4"
            >
              <View className="mb-3 flex-row items-center justify-between">
                <View
                  className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
                  style={{ backgroundColor: `${t.amber}26` }}
                >
                  <Ionicons name="checkmark-circle-outline" size={14} color={t.amber} />
                  <Text className="text-xs font-bold" style={{ color: t.amber }}>
                    {action.badge}
                  </Text>
                </View>
                <Text className="text-xs text-zinc-500">{action.date}</Text>
              </View>
              <Text className="mb-2 text-lg font-bold leading-6 text-white">{action.title}</Text>
              <View className="gap-1.5">
                {action.bullets.map((b) => (
                  <View key={b} className="flex-row items-center gap-2">
                    <Ionicons name="checkmark" size={14} color={t.brandBright} />
                    <Text className="flex-1 text-sm text-zinc-300">{b}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
