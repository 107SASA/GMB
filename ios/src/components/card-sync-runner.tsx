import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { listQueue, syncCardQueue } from '@/lib/cardQueue';

/**
 * Sends visiting cards captured on this phone (lib/cardQueue.ts) to the
 * server in the background — no screen needs to stay open. Runs when the app
 * opens, when the network comes back, when the app returns to the foreground,
 * and once a minute while anything is still waiting. Renders nothing.
 */
export function CardSyncRunner() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      const pending = (await listQueue()).some((i) => i.status === 'waiting');
      if (!pending) return;
      const { saved } = await syncCardQueue();
      if (saved > 0 && !cancelled) {
        void queryClient.invalidateQueries({ queryKey: ['crm-leads'] });
        void queryClient.invalidateQueries({ queryKey: ['card-events'] });
      }
    };

    void run();
    let wasConnected: boolean | null = null;
    const unsubNet = NetInfo.addEventListener((state) => {
      const connected = state.isConnected !== false && state.isInternetReachable !== false;
      if (connected && wasConnected === false) void run();
      wasConnected = connected;
    });
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run();
    });
    const timer = setInterval(() => void run(), 60_000);

    return () => {
      cancelled = true;
      unsubNet();
      appSub.remove();
      clearInterval(timer);
    };
  }, [queryClient]);

  return null;
}
