import { Stack } from 'expo-router';

import { LockedScreen } from '@/components/locked';
import { useSurfaceLocked } from '@/entitlements/entitlements';

import { useTheme } from '@/lib/theme';

export default function ReviewsLayout() {
  const t = useTheme();
  if (useSurfaceLocked('reviews')) return <LockedScreen surface="reviews" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
