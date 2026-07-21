import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/auth/AuthContext';
import { LockedScreen } from '@/components/locked';
import { useSurfaceLocked } from '@/entitlements/entitlements';

import { useTheme } from '@/lib/theme';

// This is the WhatsApp AI Agent's conversation view (reached from the
// WhatsApp screen), so it gets the same Super Admin–exclusive guard as
// /whatsapp — added here too in case of a direct deep link to /inbox.
export default function InboxLayout() {
  const t = useTheme();
  const { user } = useAuth();
  const locked = useSurfaceLocked('inbox');

  if (user?.role !== 'SUPER_ADMIN') {
    return <Redirect href="/more" />;
  }

  // Gating at the layout means no child screen ever mounts while locked —
  // their react-query hooks never fire.
  if (locked) return <LockedScreen surface="inbox" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
