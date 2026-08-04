import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Text, useColorScheme, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { useBusiness } from '@/business/BusinessContext';
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

/** Secondary-container pill (M3 nav-bar indicator) behind the active tab's icon. */
const SECONDARY_CONTAINER = { light: '#9af2c0', dark: '#005233' } as const;

/** Outline icon normally, filled + pill-backed when the tab is focused. */
function tabIcon(
  outline: keyof typeof Ionicons.glyphMap,
  filled: keyof typeof Ionicons.glyphMap,
  scheme: 'light' | 'dark'
) {
  return ({
    color,
    size,
    focused,
  }: {
    color: import('react-native').ColorValue;
    size: number;
    focused: boolean;
  }) => (
    <View
      style={{
        paddingHorizontal: 18,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: focused ? SECONDARY_CONTAINER[scheme] : 'transparent',
      }}
    >
      <Ionicons name={focused ? filled : outline} size={size} color={color} />
    </View>
  );
}

/** Active-tab tint follows the pill's on-secondary-container text color. */
const ACTIVE_TINT = { light: '#0c7149', dark: '#9df5c3' } as const;

export default function AppLayout() {
  const { isAuthenticated } = useAuth();
  const { isLoading, needsSelection } = useBusiness();
  const { modules } = useEntitlements();
  const t = useTheme();
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
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
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE_TINT[scheme],
        tabBarInactiveTintColor: t.textFaint,
        tabBarLabelStyle: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
        tabBarStyle: {
          backgroundColor: t.tabBg,
          borderTopColor: t.border,
          borderTopWidth: 1,
        },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      {/* Reference layout: Home · GBP · Photos · All Contacts */}
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Home', tabBarIcon: tabIcon('home-outline', 'home', scheme) }}
      />
      <Tabs.Screen
        name="gbp"
        options={{ title: 'GBP', tabBarIcon: tabIcon('storefront-outline', 'storefront', scheme) }}
      />
      <Tabs.Screen
        name="photos"
        options={{ title: 'Photos', tabBarIcon: tabIcon('folder-outline', 'folder', scheme) }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: 'All Contacts',
          href: tabHref('leads'),
          tabBarIcon: tabIcon('people-outline', 'people', scheme),
        }}
      />
      {/* Hidden sections — reachable from the header (gear/Help) and in-app links. */}
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
