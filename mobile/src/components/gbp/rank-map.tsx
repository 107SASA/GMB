import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { API_BASE_URL, getAuthToken } from '@/api/client';

/**
 * "Rank by Location" — real geo-grid map, not a placeholder. Reuses the web
 * dashboard's existing static-map image endpoint
 * (/api/audit/[id]/geo-map — color-coded rank pins, "Your Location" marker,
 * built on Google's Static Maps API) directly as an <Image>, rather than
 * pulling in a native maps SDK mobile didn't have. That endpoint requires
 * auth (requireClient(), which already supports the mobile Bearer token —
 * see src/lib/session.ts on the backend) — axios's interceptor doesn't run
 * for <Image>, so the header is attached manually here.
 */
export function RankMap({ auditId, kwIndex = 0 }: { auditId: string; kwIndex?: number }) {
  const [failed, setFailed] = useState(false);
  const token = getAuthToken();

  if (!API_BASE_URL || !token || failed) {
    return (
      <View className="items-center justify-center rounded-card border border-surface-border bg-surface-raised px-4 py-8">
        <Text className="text-center font-sans text-sm text-zinc-400">
          Map unavailable right now — open the web dashboard for the full map view.
        </Text>
      </View>
    );
  }

  return (
    <View className="overflow-hidden rounded-card border border-surface-border bg-surface-raised">
      <Image
        source={{
          uri: `${API_BASE_URL}/api/audit/${auditId}/geo-map?kwIndex=${kwIndex}`,
          headers: { Authorization: `Bearer ${token}` },
        }}
        style={{ width: '100%', aspectRatio: 16 / 9 }}
        contentFit="cover"
        onError={() => setFailed(true)}
      />
    </View>
  );
}
