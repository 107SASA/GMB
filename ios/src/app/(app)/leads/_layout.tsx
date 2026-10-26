import { Stack } from 'expo-router';

import { LockedScreen } from '@/components/locked';
import { useSurfaceLocked } from '@/entitlements/entitlements';

import { useTheme } from '@/lib/theme';

export default function LeadsLayout() {
  const t = useTheme();
  // Locked plan = no capture UI either: add/import-contacts/recent-calls all
  // live under this layout, so nothing mounts and no queries fire.
  if (useSurfaceLocked('leads')) return <LockedScreen surface="leads" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
