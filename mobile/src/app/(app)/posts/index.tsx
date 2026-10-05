import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { PostsTab } from '@/components/gbp/posts-tab';
import { LockedScreen } from '@/components/locked';
import { Screen, SegmentedControl } from '@/components/ui';
import { useBusiness } from '@/business/BusinessContext';
import { useSurfaceLocked } from '@/entitlements/entitlements';
import { useTheme } from '@/lib/theme';

import PhotosScreen from '../photos/index';

type PostsSection = 'posts' | 'photos';

/**
 * Top-level Posts tab — promoted out of the GBP hub's "Posts" sub-tab
 * (src/components/gbp/posts-tab.tsx, unchanged — already includes the
 * upcoming-7-days list, manual "+" create, and the embedded SchedulerPanel) to
 * its own bottom-bar slot. Gated on 'scheduler' (content_studio module),
 * the same surface the standalone Content Scheduler screen and the More
 * menu's "Content Scheduler" row already use — this is that same capability.
 */
export default function PostsScreen() {
  const locked = useSurfaceLocked('scheduler');
  const { activeBusinessId } = useBusiness();
  const params = useLocalSearchParams<{ tab?: string }>();
  const queryClient = useQueryClient();
  const t = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [section, setSection] = useState<PostsSection>(params.tab === 'photos' ? 'photos' : 'posts');

  useEffect(() => {
    if (params.tab === 'photos' || params.tab === 'posts') setSection(params.tab);
  }, [params.tab]);

  if (locked) return <LockedScreen surface="scheduler" />;

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ predicate: () => true });
    setRefreshing(false);
  };

  return (
    <Screen>
      <AppHeader title="Posts" />
      <SegmentedControl
        segments={[
          { id: 'posts', label: 'Posts' },
          { id: 'photos', label: 'Photos' },
        ]}
        value={section}
        onChange={setSection}
      />
      {section === 'photos' ? (
        <PhotosScreen embedded />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerClassName="pb-10"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={t.brandBright} />
          }
        >
          <PostsTab key={activeBusinessId ?? 'none'} />
        </ScrollView>
      )}
    </Screen>
  );
}
