import { Stack } from 'expo-router';

import { useTheme } from '@/lib/theme';

// WhatsApp config/booking/appointments routes are not module-gated
// server-side; conversations (which are sales_agent-gated) live in Inbox.
export default function WhatsappLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
