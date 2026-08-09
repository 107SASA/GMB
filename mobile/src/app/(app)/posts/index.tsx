import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { PostsTab } from '@/components/gbp/posts-tab';
import { LockedScreen } from '@/components/locked';
import { Screen } from '@/components/ui';
import { useSurfaceLocked } from '@/entitlements/entitlements';
import { useTheme } from '@/lib/theme';

/**
 * Top-level Posts tab — promoted out of the GBP hub's "Posts" sub-tab
 * (src/components/gbp/posts-tab.tsx, unchanged — already includes the
 * upcoming-7-days list, Generate Posts, and the embedded SchedulerPanel) to
 * its own bottom-bar slot. Gated on 'scheduler' (content_studio module),
 * the same surface the standalone Content Scheduler screen and the More
 * menu's "Content Scheduler" row already use — this is that same capability.
 */
export default function PostsScreen() {
  const locked = useSurfaceLocked('scheduler');
  const queryClient = useQueryClient();
  const t = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  if (locked) return <LockedScreen surface="scheduler" />;

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ predicate: () => true });
    setRefreshing(false);
  };

  return (
    <Screen>
      <ScrollView
        contentContainerClassName="pb-10"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={t.brandBright} />
        }
      >
        <AppHeader title="Posts" />
        <PostsTab />
      </ScrollView>
    </Screen>
  );
}
