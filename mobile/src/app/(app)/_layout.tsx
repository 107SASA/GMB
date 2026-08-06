import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { useBusiness } from '@/business/BusinessContext';
import { AppTabBar } from '@/components/app-tab-bar';
import { BusinessSwitcher } from '@/components/business-switcher';
import { LoadingScreen, Screen, ScreenTitle } from '@/components/ui';
import {
  HIDE_TAB_WHEN_LOCKED,
  SURFACE_MODULES,
  useEntitlements,
  type SurfaceKey,
} from '@/entitlements/entitlements';
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
  const { modules } = useEntitlements();
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

  // Per-module config choice: hidden tab vs visible-but-locked screen.
  // href: null removes the tab from the bar (expo-router).
  const tabHref = (surface: SurfaceKey) => {
    const moduleKey = SURFACE_MODULES[surface];
    return HIDE_TAB_WHEN_LOCKED[moduleKey] && !modules[moduleKey] ? null : undefined;
  };

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
      {/* Reference layout: Home · GBP · Photos · All Contacts */}
      <Tabs.Screen name="dashboard" options={{ title: 'Home' }} />
      <Tabs.Screen name="gbp" options={{ title: 'GBP' }} />
      <Tabs.Screen name="photos" options={{ title: 'Photos' }} />
      <Tabs.Screen name="leads" options={{ title: 'All Contacts', href: tabHref('leads') }} />
      {/* Hidden sections — reachable from the header (gear/More) and in-app links. */}
      <Tabs.Screen name="audit" options={{ href: null }} />
      <Tabs.Screen name="inbox" options={{ href: null }} />
      <Tabs.Screen name="reviews" options={{ href: null }} />
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
