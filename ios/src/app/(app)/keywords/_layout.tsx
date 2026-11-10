import { Stack } from 'expo-router';

import { LockedScreen } from '@/components/locked';
import { useSurfaceLocked } from '@/entitlements/entitlements';
import { useTheme } from '@/lib/theme';

/** Keywords — same access as the website's SEO Plan (content_studio). */
export default function KeywordsLayout() {
  const t = useTheme();
  if (useSurfaceLocked('content')) return <LockedScreen surface="content" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
