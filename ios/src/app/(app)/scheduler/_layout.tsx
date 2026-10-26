import { Stack } from 'expo-router';

import { LockedScreen } from '@/components/locked';
import { useSurfaceLocked } from '@/entitlements/entitlements';

import { useTheme } from '@/lib/theme';

export default function SchedulerLayout() {
  const t = useTheme();
  if (useSurfaceLocked('scheduler')) return <LockedScreen surface="scheduler" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
