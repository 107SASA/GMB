import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { useBusiness } from '@/business/BusinessContext';
import { AppTabBar } from '@/components/app-tab-bar';
import { BusinessSwitcher } from '@/components/business-switcher';
import { LoadingScreen, Screen, ScreenTitle } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/** Shown on first login when several businesses exist and none is chosen. */
function SelectBusinessScreen() {
  return (
    <Screen>
      <ScreenTitle>Choose a business</ScreenTitle>
      <View className="px-5 pb-4">
        <Text className="font-sans text-sm leading-5 text-zinc-400">
          Pick the business you want to work with. You can switch anytime from the More tab.
        </Text>
      </View>
      <View className="px-5">
        <BusinessSwitcher />
      </View>
    </Screen>
  );
}

export default function AppLayout() {
  const { isAuthenticated } = useAuth();
  const { isLoading, needsSelection } = useBusiness();
  const t = useTheme();
  const router = useRouter();

  // Imperative redirect (not a declarative <Redirect>) — mirrors
  // (auth)/_layout.tsx: avoids mounting <Redirect> (whose internal
  // useFocusEffect wants a stable navigator/focus context) at the exact
  // moment this layout would otherwise be swapping its own navigator out.
  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return <LoadingScreen />;
  if (isLoading) return <LoadingScreen />;
  if (needsSelection) return <SelectBusinessScreen />;

  return (
    <Tabs
      // Android back returns to the previously visited tab/screen instead of
      // always jumping to the first tab.
      backBehavior="history"
      // Custom tab bar — see components/app-tab-bar.tsx for why: the
      // built-in tabBarIcon rendering path rendered an empty pill with no
      // visible icon glyph on real devices.
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      {/* Flat 5-tab layout: Home · Performance · Posts · Media · CRM.
          (Sep 2026: Photos + Reviews merged into one "Media" tab — see
          media.tsx — to free up a slot for CRM, i.e. the existing Leads
          section promoted from More onto the bar.) Each screen gates its
          own entitlement lock now (see LockedScreen usage inside them)
          rather than the tab bar hiding itself — same convention Home/GBP
          always used. */}
      <Tabs.Screen name="dashboard" options={{ title: 'Home' }} />
      <Tabs.Screen name="performance" options={{ title: 'Performance' }} />
      <Tabs.Screen name="posts" options={{ title: 'Posts' }} />
      <Tabs.Screen name="media" options={{ title: 'Media' }} />
      <Tabs.Screen name="leads" options={{ title: 'CRM' }} />
      {/* Hidden sections — reachable from the header (gear/More) and in-app
          links. `gbp` is now just Business Profile fields (see gbp/index.tsx)
          — its Performance/Posts/Reviews/Photos sub-tabs moved to the flat
          tabs above. `photos`/`reviews` are now embedded inside the `media`
          tab above (see media.tsx) rather than tabs of their own, but stay
          registered (hidden) so existing deep links to /photos, /photos/all,
          /reviews and /reviews/[id] elsewhere in the app keep working. */}
      <Tabs.Screen name="gbp" options={{ href: null }} />
      <Tabs.Screen name="photos" options={{ href: null }} />
      <Tabs.Screen name="reviews" options={{ href: null }} />
      <Tabs.Screen name="audit" options={{ href: null }} />
      <Tabs.Screen name="inbox" options={{ href: null }} />
      <Tabs.Screen name="more" options={{ href: null }} />
      <Tabs.Screen name="content" options={{ href: null }} />
      <Tabs.Screen name="scheduler" options={{ href: null }} />
      <Tabs.Screen name="whatsapp" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="billing" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}
