import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { useBusiness } from '@/business/BusinessContext';
import { LoadingScreen } from '@/components/ui';
import { hasSeenIntro } from '@/lib/intro';
import { useTheme } from '@/lib/theme';

export default function Index() {
  const t = useTheme();
  const { isAuthenticated } = useAuth();
  const { isLoading, needsOnboarding } = useBusiness();
  // Signed-out launches show the intro slides once per install (app/welcome.tsx).
  const [introSeen, setIntroSeen] = useState<boolean | null>(null);

  useEffect(() => {
    if (isAuthenticated) return;
    let cancelled = false;
    void hasSeenIntro().then((seen) => {
      if (!cancelled) setIntroSeen(seen);
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    // A blank themed frame for the few milliseconds the flag takes to read.
    if (introSeen === null) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
    return <Redirect href={introSeen ? '/login' : '/welcome'} />;
  }
  // Wait for the workspace list before choosing between onboarding and the
  // dashboard, so a returning user never flashes the wizard.
  if (isLoading) return <LoadingScreen />;
  return <Redirect href={needsOnboarding ? '/onboarding' : '/dashboard'} />;
}
