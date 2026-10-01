import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';

import { fetchAutopilotStatus, fetchStoredWeeklyOffer } from '@/api/endpoints/weeklyOffer';
import { useBusiness } from '@/business/BusinessContext';
import { useTheme } from '@/lib/theme';

/**
 * Mirrors the web Content tab header: weekly autopilot state ("Your AI agent
 * is working on this week's posts…" while a batch is being made, then the
 * next batch date) and this week's offer exactly as the owner entered it.
 * Opening it also starts autopilot right away when the business qualifies
 * (server-side). Polls every 10s while a batch is being generated, then
 * refreshes the post lists once the posts land.
 */
export function ContentStatusStrip() {
  const t = useTheme();
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ['autopilot-status', activeBusinessId],
    queryFn: fetchAutopilotStatus,
    enabled: !!activeBusinessId,
    refetchInterval: (q) => (q.state.data?.generating ? 10_000 : false),
  });
  const offer = useQuery({
    queryKey: ['weekly-offer-stored', activeBusinessId],
    queryFn: fetchStoredWeeklyOffer,
    enabled: !!activeBusinessId,
  });

  const wasGenerating = useRef(false);
  const generating = !!status.data?.generating;
  useEffect(() => {
    if (wasGenerating.current && !generating) {
      void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer', activeBusinessId] });
      void queryClient.invalidateQueries({ queryKey: ['content-posts', activeBusinessId] });
    }
    wasGenerating.current = generating;
  }, [generating, queryClient, activeBusinessId]);

  const s = status.data;
  const box = (icon: keyof typeof Ionicons.glyphMap, body: React.ReactNode, accent = false) => (
    <View
      className="mt-3 flex-row items-start gap-2.5 rounded-card border border-surface-border px-4 py-3"
      style={{ backgroundColor: accent ? `${t.brandBright}14` : t.card }}
    >
      <Ionicons name={icon} size={16} color={accent ? t.brandBright : t.textFaint} style={{ marginTop: 1 }} />
      <Text className="flex-1 font-sans text-sm text-zinc-300">{body}</Text>
    </View>
  );

  let autopilot: React.ReactNode = null;
  if (s) {
    if (!s.hasKeywords) {
      autopilot = box('information-circle-outline', 'Weekly posts start once your target keywords are added (Onboarding / Profile).');
    } else if (!s.qualified) {
      autopilot = box('information-circle-outline', 'Weekly posts start automatically once your subscription is active and Google Business Profile is connected.');
    } else if (s.generating) {
      autopilot = box(
        'sparkles',
        <>
          <Text className="font-sans-bold text-white">Your AI agent is working on this week&apos;s posts</Text> — writing 4 posts from your
          SEO plan and creating a new image for each. They&apos;ll appear here shortly and are scheduled automatically.
        </>,
        true
      );
    } else if (s.stalled) {
      autopilot = box('time-outline', "This week's posts are taking longer than expected. Tap Generate to create them, or contact support if they still don't appear.");
    } else {
      const next = s.nextRunAt ? new Date(s.nextRunAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) : null;
      autopilot = box(
        'sparkles',
        <>
          <Text className="font-sans-bold text-white">Autopilot is on</Text> — 4 new posts with fresh images every week, scheduled
          automatically.{next ? ` Next batch: ${next}.` : ' Starting shortly.'}
        </>,
        true
      );
    }
  }

  const o = offer.data;
  const offerLine =
    o?.answered === 'YES' && o.offer
      ? box(
          'pricetag-outline',
          <>
            <Text className="font-sans-bold text-white">This week&apos;s offer (as you entered it): </Text>
            “{o.offer.text}”{o.offer.festivalName ? ` · for ${o.offer.festivalName}` : ''}
            {o.offer.endsAt ? ` · ends ${new Date(o.offer.endsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
            {o.offer.appliedToPost ? ' · used in this week’s offer post.' : ' · will be used in this week’s offer post.'}
          </>
        )
      : o?.answered === 'NONE'
        ? box('pricetag-outline', 'No offer this week — no promotional post will be created.')
        : null;

  if (!autopilot && !offerLine) return null;
  return (
    <View>
      {autopilot}
      {offerLine}
    </View>
  );
}
