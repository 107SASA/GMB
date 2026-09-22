import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '@/auth/AuthContext';
import { useBusiness } from '@/business/BusinessContext';
import { LoadingScreen } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * Gate for the in-app onboarding wizard. Only signed-in users who still have
 * onboarding to finish belong here — everyone else is bounced to /login or
 * /dashboard. Imperative redirects (not <Redirect>) for the same reason as
 * (app)/_layout.tsx and (auth)/_layout.tsx: the wizard flips its own gating
 * state as its last step, and a declarative redirect swapping this layout's
 * <Stack> out mid-interaction can strand an in-flight submit.
 */
export default function OnboardingLayout() {
  const t = useTheme();
  const { isAuthenticated } = useAuth();
  const { isLoading, needsOnboarding } = useBusiness();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (!isLoading && !needsOnboarding) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isLoading, needsOnboarding, router]);

  if (!isAuthenticated || isLoading) return <LoadingScreen />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
