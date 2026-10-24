import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '@/auth/AuthContext';

import { useTheme } from '@/lib/theme';

export default function AuthLayout() {
  const t = useTheme();
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  // Imperative redirect (not a declarative <Redirect> swapping out this
  // layout's <Stack>) — the Stack/its screens stay mounted the whole time,
  // so a still-in-flight interaction on the login screen (e.g. the
  // Sign-in button's onPress, which is what flips isAuthenticated) never
  // has the navigator it's inside of pulled out from under it mid-render.
  useEffect(() => {
    if (isAuthenticated) router.replace('/dashboard');
  }, [isAuthenticated, router]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
