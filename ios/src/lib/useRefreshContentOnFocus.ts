import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

import { useBusiness } from '@/business/BusinessContext';

/**
 * Content screens stay mounted across tab switches, so their cached posts
 * could lag behind the web. On every RE-focus (not the first mount, which
 * already fetches) this refetches the same backend state the web Content page
 * reads — the weekly posts, the schedule, autopilot status and the weekly
 * offer. Read-only: nothing here can generate posts.
 */
export function useRefreshContentOnFocus() {
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      for (const key of ['content-posts', 'scheduler-buffer', 'published-posts', 'scheduled-posts', 'scheduled-posts-count', 'dashboard-stats', 'autopilot-status', 'weekly-offer-stored']) {
        void queryClient.invalidateQueries({ queryKey: [key, activeBusinessId] });
      }
    }, [queryClient, activeBusinessId])
  );
}
