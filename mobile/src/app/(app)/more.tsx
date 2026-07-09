import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { BusinessSwitcher } from '@/components/business-switcher';
import { InitialsAvatar, Screen, ScreenTitle, SectionLabel } from '@/components/ui';
import {
  SURFACE_MODULES,
  useEntitlements,
  type SurfaceKey,
} from '@/entitlements/entitlements';
import { useTheme, type Palette } from '@/lib/theme';

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
      { label: 'Content Generator', icon: 'megaphone', href: '/content', tint: 'violet', surface: 'content' },
      { label: 'Content Scheduler', icon: 'calendar', href: '/scheduler', tint: 'cyan', surface: 'scheduler' },
    ],
  },
  {
    section: 'Customers',
    items: [
      { label: 'Leads', icon: 'people', href: '/leads', tint: 'brandBright', surface: 'leads' },
      { label: 'WhatsApp AI Agent', icon: 'logo-whatsapp', href: '/whatsapp', tint: 'emerald', superAdminOnly: true },
    ],
  },
  {
    section: 'Account',
    items: [
      { label: 'Settings', icon: 'settings', href: '/settings', tint: 'textDim' },
      { label: 'Billing', icon: 'card', href: '/billing', tint: 'cyan' },
      { label: 'Profile', icon: 'person', href: '/profile', tint: 'brandBright' },
    ],
  },
];

function MenuRow({ item, locked }: { item: MenuItem; locked: boolean }) {
  const router = useRouter();
  const t = useTheme();
  const tint = t[item.tint];
  return (
    <Pressable
      onPress={() => router.push(item.href)}
      className="flex-row items-center gap-3 border-b border-surface-border px-4 py-3 active:bg-surface-overlay"
    >
      <View
        className="h-9 w-9 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${tint}26` }}
      >
        <Ionicons name={item.icon} size={17} color={tint} />
      </View>
      <Text className="flex-1 text-base font-medium text-white">{item.label}</Text>
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

  async function handleLogout() {
    if (loggingOut) return;
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
          className="flex-row items-center gap-3.5 rounded-2xl border border-surface-border bg-surface-raised p-4 active:bg-surface-overlay"
        >
          <InitialsAvatar name={user?.name ?? user?.email} size={48} />
          <View className="flex-1">
            {!!user?.name && (
              <Text className="text-base font-bold text-white" numberOfLines={1}>
                {user.name}
              </Text>
            )}
            <Text className="text-sm text-zinc-400" numberOfLines={1}>
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
              <View className="overflow-hidden rounded-2xl border border-surface-border bg-surface-raised">
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
          className="flex-row items-center justify-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-400/10 py-3.5 active:opacity-80"
        >
          <Ionicons name="log-out-outline" size={18} color={t.rose} />
          <Text className="text-base font-bold text-rose-300">
            {loggingOut ? 'Logging out…' : 'Log out'}
          </Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
