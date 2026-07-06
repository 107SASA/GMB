import { Redirect } from 'expo-router';

import { useAuth } from '@/auth/AuthContext';

export default function Index() {
  const { isAuthenticated } = useAuth();
  return <Redirect href={isAuthenticated ? '/dashboard' : '/login'} />;
}
