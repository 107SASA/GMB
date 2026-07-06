import '../global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { BusinessProvider } from '@/business/BusinessContext';
import { palettes, useTheme } from '@/lib/theme';
import { useLastNotificationResponse } from '@/notifications/push';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 60_000 },
  },
});

// react-navigation themes matched to the app palettes so transition fills
// and headers never flash the wrong background.
const navThemes = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: palettes.light.brand,
      background: palettes.light.bg,
      card: palettes.light.card,
      border: palettes.light.border,
      text: palettes.light.text,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      primary: palettes.dark.brand,
      background: palettes.dark.bg,
      card: palettes.dark.card,
      border: palettes.dark.border,
      text: palettes.dark.text,
    },
  },
};

function RootNavigator() {
  const { isHydrating, isAuthenticated } = useAuth();
  const router = useRouter();
  const t = useTheme();

  useEffect(() => {
    if (!isHydrating) SplashScreen.hideAsync();
  }, [isHydrating]);

  // Deep-link notification taps: { leadId } → inbox thread, { reviewId } →
  // review detail. useLastNotificationResponse also covers cold starts;
  // the ref stops the same tap from re-navigating on re-renders.
  const lastResponse = useLastNotificationResponse();
  const handledResponse = useRef<string | null>(null);

  useEffect(() => {
    if (!lastResponse || isHydrating || !isAuthenticated) return;
    const id = lastResponse.notification.request.identifier;
    if (handledResponse.current === id) return;
    handledResponse.current = id;

    const data = lastResponse.notification.request.content.data as Record<string, unknown>;
    if (typeof data?.leadId === 'string') {
      router.push(`/inbox/${data.leadId}`);
    } else if (typeof data?.reviewId === 'string') {
      router.push(`/reviews/${data.reviewId}`);
    }
  }, [lastResponse, isHydrating, isAuthenticated, router]);

  // Keep the native splash visible until the stored session is restored, so
  // returning users never flash the login screen.
  if (isHydrating) return null;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BusinessProvider>
          <ThemeProvider value={scheme === 'light' ? navThemes.light : navThemes.dark}>
            <StatusBar style="auto" />
            <RootNavigator />
          </ThemeProvider>
        </BusinessProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
