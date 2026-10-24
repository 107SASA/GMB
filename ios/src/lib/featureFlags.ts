import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '@/api/client';

/**
 * Remote feature flags (GET /api/mobile/flags). Every flag defaults to OFF —
 * both when the fetch fails and when the field is missing — so risky
 * features can never turn themselves on without the server saying so.
 *
 * androidCallLogCapture: gates the READ_CALL_LOG capture UI (Plan B). Must
 * stay off until a build ships the native module AND Google Play's
 * Permissions Declaration Form is approved. See README "Store compliance".
 */
const flagsSchema = z.object({
  androidCallLogCapture: z.boolean().catch(false),
});
export type MobileFlags = z.infer<typeof flagsSchema>;

const OFF: MobileFlags = { androidCallLogCapture: false };

export function useMobileFlags(): MobileFlags {
  const { data } = useQuery({
    queryKey: ['mobile-flags'],
    queryFn: async () => flagsSchema.parse((await api.get('/api/mobile/flags')).data),
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  return data ?? OFF;
}
