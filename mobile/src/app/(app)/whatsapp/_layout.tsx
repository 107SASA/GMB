import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/auth/AuthContext';
import { useTheme } from '@/lib/theme';

// WhatsApp config/booking/appointments routes are not module-gated
// server-side; conversations (which are sales_agent-gated) live in Inbox.
//
// WhatsApp AI Agent is a Super Admin–exclusive feature. Non-super-admins
// (including anyone deep-linking straight to /whatsapp) are redirected back
// to the More menu before any screen in this stack mounts.
export default function WhatsappLayout() {
  const t = useTheme();
  const { user } = useAuth();

  if (user?.role !== 'SUPER_ADMIN') {
    return <Redirect href="/more" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
