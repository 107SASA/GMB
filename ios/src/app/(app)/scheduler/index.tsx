import { Text, View } from 'react-native';

import { SchedulerPanel } from '@/components/scheduler-panel';
import { Screen, ScreenTitle } from '@/components/ui';
import { useRefreshContentOnFocus } from '@/lib/useRefreshContentOnFocus';

/**
 * Content Scheduler — the scheduled weekly posts (same data as the web
 * Content page). No "Generate" action: the 4 weekly posts are created and
 * scheduled automatically by the weekly job (a manual batch duplicated posts
 * and AI / image-generation cost; removed Oct 2026).
 */
export default function SchedulerScreen() {
  useRefreshContentOnFocus();
  return (
    <Screen>
      <ScreenTitle>Content Scheduler</ScreenTitle>
      <View className="px-5 pb-2">
        <Text className="font-sans text-xs leading-4 text-zinc-400">
          Your weekly posts are generated automatically — 4 posts every week from your SEO plan, business information,
          keywords, offers and relevant festivals.
        </Text>
      </View>
      <SchedulerPanel />
    </Screen>
  );
}
