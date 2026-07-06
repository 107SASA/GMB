import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/auth/AuthContext';

import { useTheme } from '@/lib/theme';

export default function AuthLayout() {
  const t = useTheme();
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) return <Redirect href="/dashboard" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
