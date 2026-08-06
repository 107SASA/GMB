import '../global.css';

import { Inter_400Regular, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import {
  PublicSans_700Bold,
  PublicSans_800ExtraBold,
} from '@expo-google-fonts/public-sans';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import Constants from 'expo-constants';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { BusinessProvider } from '@/business/BusinessContext';
import { OfflineBanner } from '@/components/offline-banner';
import { palettes, useTheme } from '@/lib/theme';
import { useLastNotificationResponse } from '@/notifications/push';

SplashScreen.preventAutoHideAsync();

// Exported so non-component code (lib/connectGoogle.ts) can invalidate
// queries directly — the Google OAuth "connect" flow opens an in-app
// browser with no deep-link/redirect handling back into the app, so
// nothing else refetches the GBP/business status once the user returns.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 60_000 },
  },
});

// Persists successful query results to on-device storage so the last-known
// data (dashboard stats, reviews, content, …) still renders when the app
// opens offline, instead of a blank/error screen. Rehydration is capped at
// 24h and namespaced by app version so a schema change never loads stale,
// incompatible cache from an old build.
const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'growwmatics-query-cache',
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
  const { isHydrating, isAuthenticated, user } = useAuth();
  const router = useRouter();
  const t = useTheme();

  const [fontsLoaded] = useFonts({
    PublicSans_700Bold,
    PublicSans_800ExtraBold,
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (!isHydrating && fontsLoaded) SplashScreen.hideAsync();
  }, [isHydrating, fontsLoaded]);

  // Deep-link notification taps: { leadId } → inbox thread, { reviewId } →
  // review detail, { postId } → content tab (no per-post detail screen on
  // mobile — the published post is visible in that list).
  // useLastNotificationResponse also covers cold starts; the ref stops the
  // same tap from re-navigating on re-renders.
  const lastResponse = useLastNotificationResponse();
  const handledResponse = useRef<string | null>(null);

  useEffect(() => {
    if (!lastResponse || isHydrating || !isAuthenticated) return;
    const id = lastResponse.notification.request.identifier;
    if (handledResponse.current === id) return;
    handledResponse.current = id;

    const data = lastResponse.notification.request.content.data as Record<string, unknown>;
    // Inbox is SUPER_ADMIN-only ((app)/inbox/_layout.tsx redirects everyone
    // else to /more) — routing a regular business-owner here from a raw
    // push tap silently bounced them to /more with no explanation, which
    // just reads as "the notification is broken". See the same gate in
    // notifications.tsx's LINK_MAP for the in-app notification list.
    if (typeof data?.leadId === 'string' && user?.role === 'SUPER_ADMIN') {
      router.push(`/inbox/${data.leadId}`);
    } else if (typeof data?.reviewId === 'string') {
      router.push(`/reviews/${data.reviewId}`);
    } else if (typeof data?.postId === 'string') {
      router.push('/content');
    }
  }, [lastResponse, isHydrating, isAuthenticated, user, router]);

  // Keep the native splash visible until the stored session is restored and
  // the Public Sans / Inter fonts are ready, so returning users never flash
  // the login screen or a system-font layout jump.
  if (isHydrating || !fontsLoaded) return null;

  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.bg },
        }}
      />
      <OfflineBanner />
    </View>
  );
}

function RootLayout() {
  const scheme = useColorScheme();
  return (
    // Required at the true root by react-native-gesture-handler — react-native-screens'
    // native-stack navigator (what expo-router's <Stack> uses) relies on gesture-handler
    // internally for its transitions. Without this wrapper, gesture-handler's internal
    // recognizers can swallow the entire touch-responder chain app-wide: every Pressable
    // renders and looks normal, but nothing anywhere responds to taps.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: 24 * 60 * 60 * 1000,
          buster: Constants.expoConfig?.version,
          // Only persist queries that actually resolved — an errored or
          // still-pending query has nothing useful to show from a cold start.
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => query.state.status === 'success',
          },
        }}
      >
        <AuthProvider>
          <BusinessProvider>
            <ThemeProvider value={scheme === 'light' ? navThemes.light : navThemes.dark}>
              <StatusBar style="auto" />
              <RootNavigator />
            </ThemeProvider>
          </BusinessProvider>
        </AuthProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default RootLayout;
