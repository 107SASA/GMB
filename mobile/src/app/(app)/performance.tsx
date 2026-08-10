import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { PerformanceTab } from '@/components/gbp/performance-tab';
import { LockedScreen } from '@/components/locked';
import { Screen } from '@/components/ui';
import { useSurfaceLocked } from '@/entitlements/entitlements';
import { useTheme } from '@/lib/theme';

/**
 * Top-level Performance tab — promoted out of the GBP hub's "Performance"
 * sub-tab (src/components/gbp/performance-tab.tsx, unchanged) to its own
 * bottom-bar slot, matching the flat Home/Performance/Posts/Photos/Reviews
 * layout. Same entitlement gate the GBP hub used ('dashboard' surface —
 * google_ranking_agent module), since this is the same capability, just
 * relocated.
 *
 * A FLAT file (not performance/index.tsx) — this has no sub-routes, and a
 * folder with only an index.tsx and no _layout.tsx registers as route name
 * "performance/index" instead of "performance" (confirmed via a runtime
 * diagnostic, Aug 2026), which silently broke the AppTabBar icon lookup
 * (ICONS["performance/index"] is undefined -> the tab renders nothing).
 * dashboard.tsx uses this same flat-file pattern for the same reason.
 */
export default function PerformanceScreen() {
  const locked = useSurfaceLocked('dashboard');
  const queryClient = useQueryClient();
  const t = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  if (locked) return <LockedScreen surface="dashboard" />;

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
        <AppHeader title="Performance" />
        <PerformanceTab />
      </ScrollView>
    </Screen>
  );
}
