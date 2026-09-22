import { Redirect } from 'expo-router';

import { useAuth } from '@/auth/AuthContext';
import { useBusiness } from '@/business/BusinessContext';
import { LoadingScreen } from '@/components/ui';

export default function Index() {
  const { isAuthenticated } = useAuth();
  const { isLoading, needsOnboarding } = useBusiness();

  if (!isAuthenticated) return <Redirect href="/login" />;
  // Wait for the workspace list before choosing between onboarding and the
  // dashboard, so a returning user never flashes the wizard.
  if (isLoading) return <LoadingScreen />;
  return <Redirect href={needsOnboarding ? '/onboarding' : '/dashboard'} />;
}
