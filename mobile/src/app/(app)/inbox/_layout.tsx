import { Stack } from 'expo-router';

import { LockedScreen } from '@/components/locked';
import { useSurfaceLocked } from '@/entitlements/entitlements';

import { useTheme } from '@/lib/theme';

export default function InboxLayout() {
  const t = useTheme();
  // Gating at the layout means no child screen ever mounts while locked —
  // their react-query hooks never fire.
  if (useSurfaceLocked('inbox')) return <LockedScreen surface="inbox" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
