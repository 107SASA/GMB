import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { BusinessSwitcher } from '@/components/business-switcher';
import { ConfirmSheet, InitialsAvatar, Screen, ScreenTitle, SectionLabel } from '@/components/ui';
import {
  SURFACE_MODULES,
  useEntitlements,
  type SurfaceKey,
} from '@/entitlements/entitlements';
import { useTheme, withAlpha, type Palette } from '@/lib/theme';

/**
 * The app's counterpart of the website sidebar: every section that doesn't
 * fit in the 5-slot tab bar lives here. Locked modules stay tappable — the
 * section's own layout renders the LockedScreen.
 */

interface MenuItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: Href;
  /** Palette key for the icon chip tint (resolved per color scheme). */
  tint: keyof Pick<Palette, 'amber' | 'violet' | 'cyan' | 'emerald' | 'rose' | 'brandBright' | 'textDim'>;
  /** When set, a lock icon shows if the mapped module is disabled. */
  surface?: SurfaceKey;
  /** When true, only shown to Super Admin users. */
  superAdminOnly?: boolean;
}

const MENU: { section: string; items: MenuItem[] }[] = [
  {
    section: 'Grow',
    items: [
      { label: 'Audit Engine', icon: 'flash', href: '/audit', tint: 'amber' },
      { label: 'Business Profile', icon: 'storefront', href: '/gbp', tint: 'brandBright', surface: 'dashboard' },
      { label: 'Content Generator', icon: 'megaphone', href: '/content', tint: 'violet', surface: 'content' },
      { label: 'Content Scheduler', icon: 'calendar', href: '/scheduler', tint: 'cyan', surface: 'scheduler' },
    ],
  },
  {
    section: 'Customers',
    items: [
      // Leads (now "CRM") moved onto the bottom tab bar (Sep 2026) —
      // dropped from here so it isn't listed in two places.
      // Inbox removed from here too (owner's explicit call, Sep 2026) — the
      // route itself is untouched and still reachable via deep links (the
      // lead detail screen's "Inbox" quick action, push notifications for
      // new messages), just no longer a standalone nav entry.
      { label: 'WhatsApp AI Agent', icon: 'logo-whatsapp', href: '/whatsapp', tint: 'emerald', superAdminOnly: true },
    ],
  },
  {
    section: 'Account',
    items: [
      { label: 'Notifications', icon: 'notifications', href: '/notifications', tint: 'rose' },
      { label: 'Settings', icon: 'settings', href: '/settings', tint: 'textDim' },
      { label: 'Billing', icon: 'card', href: '/billing', tint: 'cyan' },
      { label: 'Profile', icon: 'person', href: '/profile', tint: 'brandBright' },
    ],
  },
];

// Every tab/screen not in the 5-slot bottom bar (Home/Performance/Posts/
// Media/CRM) is intentionally routed through here for now — Aug 2026,
// per an explicit ask to park everything under More rather than deciding
// per-screen whether it stays in the app. Audit/Business Profile/Content
// Generator/Content Scheduler/WhatsApp AI Agent/Settings/Billing/Profile/
// Notifications are all listed above. Inbox is deliberately NOT listed
// (Sep 2026, owner's call) — reachable only via deep links now, not a nav
// entry. Nothing else hidden is currently unreachable.

function MenuRow({ item, locked }: { item: MenuItem; locked: boolean }) {
  const router = useRouter();
  const t = useTheme();
  const tint = t[item.tint];
  return (
    <Pressable
      onPress={() => router.push(item.href)}
      // No `className` — react-native-css-interop can swallow onPress on
      // styled Pressables (see src/components/ui.tsx PrimaryButton).
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: t.border,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <View
        className="h-9 w-9 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${tint}26` }}
      >
        <Ionicons name={item.icon} size={17} color={tint} />
      </View>
      <Text className="flex-1 font-sans-semibold text-base text-white">{item.label}</Text>
      {locked && <Ionicons name="lock-closed" size={15} color={t.textFaint} />}
      <Ionicons name="chevron-forward" size={16} color={t.textFaint} />
    </Pressable>
  );
}

export default function MoreScreen() {
  const { user, logout } = useAuth();
  const { modules } = useEntitlements();
  const router = useRouter();
  const t = useTheme();
  const [loggingOut, setLoggingOut] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  // Every other quasi-destructive action in the app (disconnect Google,
  // delete workspace, delete post, cancel appointment, reject reply)
  // confirms first — logout previously fired immediately on tap, so a
  // single mis-tap logged the user out with no "are you sure." Uses the
  // app's own ConfirmSheet (components/ui.tsx) rather than the OS's native
  // Alert.alert, which rendered as a plain system dialog that clashed with
  // the rest of the UI (Aug 2026 feedback).
  function handleLogout() {
    if (loggingOut) return;
    setConfirmingLogout(true);
  }

  async function confirmLogout() {
    setConfirmingLogout(false);
    setLoggingOut(true);
    await logout();
    // (app)/_layout redirects to /login once isAuthenticated flips.
  }

  return (
    <Screen>
      <ScreenTitle>More</ScreenTitle>
      <ScrollView contentContainerClassName="px-5 pb-10">
        <Pressable
          onPress={() => router.push('/profile')}
          // No `className` — see note above.
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.card,
            padding: 16,
          }}
        >
          <InitialsAvatar name={user?.name ?? user?.email} size={48} />
          <View className="flex-1">
            {!!user?.name && (
              <Text className="font-display-bold text-base text-white" numberOfLines={1}>
                {user.name}
              </Text>
            )}
            <Text className="font-sans text-sm text-zinc-400" numberOfLines={1}>
              {user?.email}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={t.textFaint} />
        </Pressable>

        <SectionLabel>Workspace</SectionLabel>
        <BusinessSwitcher />

        {MENU.map(({ section, items }) => {
          const visibleItems = items.filter((item) => !item.superAdminOnly || user?.role === 'SUPER_ADMIN');
          if (visibleItems.length === 0) return null;
          return (
            <View key={section}>
              <SectionLabel>{section}</SectionLabel>
              <View className="overflow-hidden rounded-card border border-surface-border bg-surface-raised">
                {visibleItems.map((item) => (
                  <MenuRow
                    key={item.label}
                    item={item}
                    locked={item.surface ? !modules[SURFACE_MODULES[item.surface]] : false}
                  />
                ))}
              </View>
            </View>
          );
        })}

        <SectionLabel>Session</SectionLabel>
        <Pressable
          onPress={handleLogout}
          disabled={loggingOut}
          // No `className` — see note above.
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: withAlpha(t.rose, 0.25),
            backgroundColor: t.errorContainer,
            paddingVertical: 14,
          }}
        >
          <Ionicons name="log-out-outline" size={18} color={t.rose} />
          <Text className="font-sans-bold text-base text-on-error-container">
            {loggingOut ? 'Logging out…' : 'Log out'}
          </Text>
        </Pressable>
      </ScrollView>

      <ConfirmSheet
        visible={confirmingLogout}
        onCancel={() => setConfirmingLogout(false)}
        onConfirm={confirmLogout}
        title="Log out?"
        message="You’ll need to sign in again to access your account."
        confirmLabel="Log out"
        destructive
      />
    </Screen>
  );
}
