import { Stack } from 'expo-router';

import { LockedScreen } from '@/components/locked';
import { useSurfaceLocked } from '@/entitlements/entitlements';
import { useTheme } from '@/lib/theme';

export default function ProfileOptimizationLayout() {
  const t = useTheme();
  if (useSurfaceLocked('dashboard')) return <LockedScreen surface="dashboard" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
