import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { Text, View } from 'react-native';

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
        <Text className="text-sm leading-5 text-zinc-400">
          Pick the business you want to work with. You can switch anytime from the More tab.
        </Text>
      </View>
      <View className="px-5">
        <BusinessSwitcher />
      </View>
    </Screen>
  );
}

/** Outline icon normally, filled when the tab is focused. */
function tabIcon(outline: keyof typeof Ionicons.glyphMap, filled: keyof typeof Ionicons.glyphMap) {
  return ({
    color,
    size,
    focused,
  }: {
    color: import('react-native').ColorValue;
    size: number;
    focused: boolean;
  }) => (
    <Ionicons name={focused ? filled : outline} size={size} color={color} />
  );
}

export default function AppLayout() {
  const { isAuthenticated } = useAuth();
  const { isLoading, needsSelection } = useBusiness();
  const { modules } = useEntitlements();
  const t = useTheme();

  if (!isAuthenticated) return <Redirect href="/login" />;
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
        tabBarActiveTintColor: t.brandBright,
        tabBarInactiveTintColor: t.textFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
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
        options={{ title: 'Home', tabBarIcon: tabIcon('home-outline', 'home') }}
      />
      <Tabs.Screen
        name="gbp"
        options={{ title: 'GBP', tabBarIcon: tabIcon('storefront-outline', 'storefront') }}
      />
      <Tabs.Screen
        name="photos"
        options={{ title: 'Photos', tabBarIcon: tabIcon('folder-outline', 'folder') }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: 'All Contacts',
          href: tabHref('leads'),
          tabBarIcon: tabIcon('people-outline', 'people'),
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
    </Tabs>
  );
}
