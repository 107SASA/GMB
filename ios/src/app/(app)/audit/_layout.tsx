import { Stack } from 'expo-router';

import { useTheme } from '@/lib/theme';

// Audit routes are not module-gated server-side — only per-plan usage
// limits apply, surfaced per-request as PlanLimitError.
export default function AuditLayout() {
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
