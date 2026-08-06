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

type AiAction = {
  key: string;
  badge: string;
  date: string;
  title: string;
  bullets: string[];
  /** Present only for items that represent a specific, completable task. */
  onPress?: () => void;
};

/**
 * "AI Actions" feed card — what the platform has recently done for this
 * business, and what's left to complete.
 *
 * Each card here maps 1:1 to a specific `priorityFixes`/`quickWins` entry on
 * the latest audit (in that priority order — fixes matter more than wins),
 * keyed as `${section}-${index}`. That key is a stable id for a given audit
 * document without needing a DB migration: audit content is generated once
 * and never reordered/edited after creation, so array position is already
 * permanent. Tapping a card deep-links straight to that item, highlighted
 * and scrolled into view, inside its audit (`/audit/[id]?highlight=<key>`,
 * handled in audit/[id].tsx) — previously nothing here was tappable except
 * "View All", which just opened the generic audit list.
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

  const actions: AiAction[] = [];

  if (audit) {
    const priorityFixes = audit.auditData?.priorityFixes ?? [];
    const quickWins = audit.auditData?.quickWins ?? [];
    const date = shortDate(audit.createdAt);

    // Priority fixes first (highest-impact, concrete tasks); quick wins as
    // a fallback so the card isn't empty when the audit found no fixes.
    priorityFixes.slice(0, 2).forEach((fix, i) => {
      actions.push({
        key: `priorityFixes-${i}`,
        badge: 'Priority Fix',
        date,
        title: fix.title,
        bullets: [fix.detail, fix.impact ? `Impact: ${fix.impact}` : null].filter(
          (b): b is string => !!b
        ),
        onPress: () => router.push(`/audit/${audit._id}?highlight=priorityFixes-${i}`),
      });
    });
    if (priorityFixes.length === 0) {
      quickWins.slice(0, 2).forEach((win, i) => {
        actions.push({
          key: `quickWins-${i}`,
          badge: 'Quick Win',
          date,
          title: win,
          bullets: [],
          onPress: () => router.push(`/audit/${audit._id}?highlight=quickWins-${i}`),
        });
      });
    }
    // No individual action items on this audit at all — fall back to the
    // old summary card so something still shows, tapping opens the full report.
    if (actions.length === 0) {
      actions.push({
        key: 'audit-summary',
        badge: 'Profile Audited',
        date,
        title: 'Your Google Business Profile: audited to attract more customers',
        bullets: [audit.overallScore != null ? `Overall score ${audit.overallScore}/100` : 'Audit completed'],
        onPress: () => router.push(`/audit/${audit._id}`),
      });
    }
  }
  if (latestPublished) {
    // Already completed — nothing left to do, so this one stays
    // non-interactive (no onPress), same as before.
    actions.push({
      key: 'latest-post',
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
          <Text className="font-display-bold text-lg text-white">AI Actions</Text>
        </View>
        {showViewAll && (
          <Pressable
            onPress={() => router.push('/audit')}
            // No `className` — react-native-css-interop can swallow onPress
            // on styled Pressables (see components/ui.tsx).
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
              View All
            </Text>
            <Ionicons name="chevron-forward" size={14} color={t.brandBright} />
          </Pressable>
        )}
      </View>

      {actions.length === 0 ? (
        <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-6">
          <Text className="font-sans text-sm leading-5 text-zinc-400">
            No AI actions yet — run an audit or schedule posts and the work done for your profile
            shows up here.
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {actions.map((action) => {
            return (
              <Pressable
                key={action.key}
                onPress={action.onPress}
                disabled={!action.onPress}
                // No `className` — react-native-css-interop can swallow
                // onPress on styled Pressables (see components/ui.tsx).
                style={{
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: t.border,
                  backgroundColor: t.card,
                  padding: 16,
                }}
              >
                <View className="mb-3 flex-row items-center justify-between">
                  <View className="flex-row items-center gap-1.5 rounded-full bg-warning-container px-3 py-1.5">
                    <Ionicons name="checkmark-circle-outline" size={14} color={t.amber} />
                    <Text className="font-sans-bold text-[11px] uppercase tracking-[0.6px] text-on-warning-container">
                      {action.badge}
                    </Text>
                  </View>
                  <Text className="font-sans text-xs text-zinc-500">{action.date}</Text>
                </View>
                <View className="flex-row items-start justify-between gap-2">
                  <Text className="mb-2 flex-1 font-display-bold text-lg leading-6 text-white">
                    {action.title}
                  </Text>
                  {!!action.onPress && (
                    <Ionicons name="chevron-forward" size={18} color={t.brandBright} style={{ marginTop: 3 }} />
                  )}
                </View>
                {action.bullets.length > 0 && (
                  <View className="gap-1.5">
                    {action.bullets.map((b) => (
                      <View key={b} className="flex-row items-center gap-2">
                        <Ionicons name="checkmark" size={14} color={t.brandBright} />
                        <Text className="flex-1 font-sans text-sm text-zinc-300">{b}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {!!action.onPress && (
                  <Text className="mt-2 font-sans-bold text-xs" style={{ color: t.brandBright }}>
                    Tap to complete →
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
