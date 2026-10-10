import { Ionicons } from '@expo/vector-icons';
// expo-router doesn't re-export this type from its root — it vendors its own
// bottom-tabs fork rather than depending on the public @react-navigation
// package (see components/app-tab-bar.tsx doc comment below for why this
// file exists at all).
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { Pressable, Text, useColorScheme, useWindowDimensions, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/** Secondary-container pill (M3 nav-bar indicator) behind the active tab's icon. */
const SECONDARY_CONTAINER = { light: '#9af2c0', dark: '#005233' } as const;
const ACTIVE_TINT = { light: '#0c7149', dark: '#9df5c3' } as const;

const ICONS: Record<string, { outline: keyof typeof Ionicons.glyphMap; filled: keyof typeof Ionicons.glyphMap }> = {
  dashboard: { outline: 'home-outline', filled: 'home' },
  performance: { outline: 'stats-chart-outline', filled: 'stats-chart' },
  posts: { outline: 'newspaper-outline', filled: 'newspaper' },
  reviews: { outline: 'star-outline', filled: 'star' },
  // CRM tab (app/(app)/leads/* — same routes as before, now on the bar).
  leads: { outline: 'people-outline', filled: 'people' },
};

/**
 * Custom replacement for expo-router's built-in tabBarIcon rendering.
 *
 * The built-in path (BottomTabItem → TabBarIcon, vendored inside
 * expo-router/build/react-navigation/bottom-tabs) renders each icon TWICE,
 * absolutely stacked, faded between with an `opacity` style prop — on real
 * devices this consistently rendered as an empty pill with no visible icon
 * glyph at all (confirmed via screenshots), while the exact same Ionicons
 * glyphs render fine everywhere else in the app. Given this session already
 * found and patched two other real bugs in this exact vendored
 * interop/animation chain (see patches/react-native-css-interop+0.2.6.patch
 * and the GestureHandlerRootView fix), rendering the tab bar entirely
 * ourselves — one plain Ionicons per tab, no double-stacking, no
 * opacity-driven crossfade — sidesteps whatever that bug is rather than
 * relying on a rendering path already proven fragile.
 */
export function AppTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const t = useTheme();
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  const { width } = useWindowDimensions();
  const narrow = width < 360;
  const pillPad = narrow ? 10 : width < 400 ? 14 : 18;
  const iconSize = narrow ? 22 : 24;
  // Explicit half-height radius (icon + 2×4 padding) instead of 999.
  const pillRadius = (iconSize + 8) / 2;

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.tabBg,
        borderTopWidth: 1,
        borderTopColor: t.border,
        paddingBottom: Math.max(insets.bottom, 8),
        paddingTop: 8,
      }}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        // Mirrors expo-router's own default tab bar: href:null removes a
        // screen from the tab bar (it's still reachable via router.push).
        if ((options as { href?: unknown }).href === null) return null;

        const icon = ICONS[route.name];
        if (!icon) return null;

        const focused = state.index === index;
        const label = typeof options.title === 'string' ? options.title : route.name;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={label}
            // No `className` here — see components/ui.tsx PrimaryButton for
            // why Pressable + className is unsafe in this app.
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 44, paddingVertical: 2, paddingHorizontal: 2 }}
          >
            <View style={{ paddingHorizontal: pillPad, paddingVertical: 4 }}>
              {/*
                The pill is its own layer whose colour and radius never change
                after mount; only its opacity follows focus. Toggling
                backgroundColor on an already-rounded view (transparent ↔
                colour) let Android drop the corner radius after a few tab
                switches, showing a square-cornered block.
              */}
              <View
                style={{
                  pointerEvents: 'none',
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  right: 0,
                  borderRadius: pillRadius,
                  backgroundColor: SECONDARY_CONTAINER[scheme],
                  opacity: focused ? 1 : 0,
                }}
              />
              <Ionicons
                name={focused ? icon.filled : icon.outline}
                size={iconSize}
                color={focused ? ACTIVE_TINT[scheme] : t.textFaint}
              />
            </View>
            <Text
              // numberOfLines + adjustsFontSizeToFit — without these, this
              // Text had no width constraint of its own (RN's default
              // behavior wraps overflowing text rather than shrinking it),
              // so on narrower phones the longest label ("Performance")
              // could overflow its flex:1 tab slot and wrap its last
              // character onto a second line. Shrinks to fit instead of
              // wrapping, on any screen width — not a fix specific to one
              // label.
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={{
                fontSize: narrow ? 10 : 11,
                fontFamily: 'Inter_700Bold',
                letterSpacing: width < 400 ? 0 : 0.3,
                color: focused ? ACTIVE_TINT[scheme] : t.textFaint,
                textAlign: 'center',
                maxWidth: '100%',
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
