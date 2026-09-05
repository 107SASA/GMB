import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { BusinessAssets } from '@/components/business-assets';
import { Screen } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * Photos tab — recent photos/videos summary, "View All" into the full
 * filterable gallery (photos/all.tsx), and the scheduled-photos timeline.
 *
 * Pull-to-refresh (same pattern as performance.tsx) — this tab stays mounted
 * across tab switches (React Navigation doesn't remount tabs by default), so
 * without this the gbp-media query never re-ran and newly-synced Google
 * photos (see listLocationMedia's pagination fix) never showed up until an
 * app restart happened to remount it.
 */
export default function PhotosScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const t = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ predicate: () => true });
    setRefreshing(false);
  };

  const body = (
    <ScrollView
      contentContainerClassName="pt-4 pb-10"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={t.brandBright} />
      }
    >
      <BusinessAssets />
    </ScrollView>
  );

  // Embedded inside media.tsx: that screen already owns the single
  // Screen/AppHeader for the combined tab.
  if (embedded) return body;

  return (
    <Screen>
      <AppHeader title="Photos" />
      {body}
    </Screen>
  );
}
