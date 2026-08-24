import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { fetchNotifications } from '@/api/endpoints/notifications';
import { useBusiness } from '@/business/BusinessContext';
import { BusinessSwitcher } from '@/components/business-switcher';
import { InfoSheet, InitialsAvatar } from '@/components/ui';
import { getSupportWhatsAppLink } from '@/lib/support';
import { useTheme } from '@/lib/theme';

/**
 * Global screen header used by every top-level tab:
 *   [business logo]  Title            [help]  [bell]  [menu]
 *                    Location ⌄
 * Tapping the location line opens the business switcher; the hamburger menu
 * opens the More screen (account/workspace hub — Grow/Customers/Account
 * sections, including Settings and Notifications). Settings' own header
 * icon was removed (Aug 2026) — it was pure redundancy with More → Settings,
 * the exact same destination either way, just extra header clutter. The
 * bell stays: an at-a-glance unread count is genuinely useful without
 * opening a menu, unlike a settings shortcut that goes nowhere different.
 *
 * Help opens WhatsApp with a prefilled message to the GrowwMatics support
 * line, routed server-side to a real support intent (see
 * api/whatsapp/webhook/route.ts's classifyIntent + SupportConversation on
 * the backend). Labeled "Help" (not just an icon) and filled with
 * WhatsApp's own darker brand teal (#128C7E, the color WhatsApp's own app
 * bar uses — NOT the brighter #25D366 accent green, which read as too loud/
 * neon against this header's dark background) so it reads as "opens
 * WhatsApp" without competing with everything else on screen — Aug 2026:
 * this header used to have a button literally labeled "Help" that opened
 * the More screen, renamed at the time because there was no real help/
 * support content behind it; that's what this new button actually provides
 * now, so the two aren't the same thing reappearing.
 *
 * Deliberately sits on the plain screen background (t.bg), not the brand
 * gradient — the green diagonal band read as loud/dated next to the rest of
 * the UI (Aug 2026 feedback). Text/icon colors below are theme-aware (t.text
 * etc.), NOT the `on-brand` token (always-white, meant for the brand-colored
 * surfaces this header no longer is) — on a light background that white
 * would go invisible in light mode. Brand green (the app's own, distinct
 * from WhatsApp's) is kept only as small accents (see BRAND_GRADIENT in
 * theme.ts, still used by buttons/login).
 */
const WHATSAPP_GREEN = '#128C7E';

export function AppHeader({ title }: { title: string }) {
  const { activeBusiness } = useBusiness();
  const router = useRouter();
  const t = useTheme();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Themed in-app dialog (InfoSheet) instead of the native Alert.alert —
  // that rendered as a plain grey OS popup, jarring against this app's dark
  // theme everywhere else.
  const [helpInfo, setHelpInfo] = useState<{ title: string; message: string } | null>(null);

  // Light polling — this badge just needs to be roughly fresh, not live.
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const unread = notifications.data?.unreadCount ?? 0;

  // "Bidhannagar, Kolkata" line — best-effort from the address.
  const location = activeBusiness?.address
    ? activeBusiness.address.split(',').slice(-2).join(',').trim()
    : (activeBusiness?.category ?? '');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingBottom: 12,
        paddingTop: 8,
        backgroundColor: t.bg,
        // Gap before whatever content follows the header on every screen.
        marginBottom: 14,
      }}
    >
      {/* No `colors` override — falls back to InitialsAvatar's own
          BRAND_GRADIENT default, which is the validated white-text-safe
          pairing. A theme-color pairing here would put white initials text
          on a near-white circle in light mode. This also keeps one small
          brand-green accent in the header, matching the "green only as
          small accents" direction. */}
      <InitialsAvatar name={activeBusiness?.name} size={44} imageUrl={activeBusiness?.logoUrl} />

      <View className="flex-1">
        <Text className="font-display text-xl tracking-tight" style={{ color: t.text }} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          onPress={() => setSwitcherOpen(true)}
          // No `className` on Pressable — react-native-css-interop can
          // swallow onPress on styled Pressables (see ui.tsx PrimaryButton).
          // alignSelf: 'flex-start' used to let this row shrink to its own
          // content width — but Views default to overflow: visible in RN,
          // so a long business name/address wasn't actually clipped by
          // numberOfLines, it just visually overflowed past this row's own
          // box, running underneath the Help button next to it. Now stretches
          // to fill the parent's already-bounded flex-1 width instead, so
          // the Text's numberOfLines={1} ellipsis has a real width to
          // truncate against.
          style={{ marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <Text className="shrink font-sans-semibold text-sm" style={{ color: t.textDim }} numberOfLines={1}>
            {location || activeBusiness?.name || 'Select business'}
          </Text>
          <Ionicons name="chevron-down" size={14} color={t.textFaint} />
        </Pressable>
      </View>

      <Pressable
        onPress={() => {
          const link = getSupportWhatsAppLink();
          if (!link) {
            // Number not configured yet in this build/environment — never a
            // dead tap with no feedback.
            setHelpInfo({
              title: 'Help is on the way',
              message: "We're setting this up — in the meantime, reach us at support@growwmatics.com.",
            });
            return;
          }
          // wa.me is a plain https:// link — the OS almost always "succeeds"
          // at opening it either way (into the WhatsApp app if installed, or
          // a browser fallback page if not), so this catch is a true
          // last-resort (malformed URL, no browser/app can handle it at
          // all) rather than a reliable "WhatsApp isn't installed" check.
          // Reliably detecting that ahead of time needs Linking.canOpenURL
          // with native config (LSApplicationQueriesSchemes on iOS, a
          // matching Android <queries> entry) and a rebuild — bigger than
          // this fix; the email fallback here at least covers the hard-fail case.
          Linking.openURL(link).catch(() =>
            setHelpInfo({
              title: 'Could not open WhatsApp',
              message: "Make sure WhatsApp is installed, then try again — or reach us at support@growwmatics.com.",
            })
          );
        }}
        // No `className` — see note above. A labeled pill, not an icon-only
        // circle — "Help" spelled out removes any doubt about what tapping
        // it does, which a logo/icon alone left to guesswork. Still filled
        // with WhatsApp's own brand green (not the app's) as a secondary,
        // reinforcing signal that it opens WhatsApp specifically.
        style={{
          height: 40,
          borderRadius: 999,
          paddingHorizontal: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: WHATSAPP_GREEN,
        }}
      >
        <Text className="font-sans-bold text-sm text-white">Help</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push('/notifications')}
        // No `className` — see note above.
        style={{ height: 40, width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999 }}
      >
        <View>
          <Ionicons name="notifications-outline" size={22} color={t.text} />
          {unread > 0 && (
            <View className="absolute -right-0.5 -top-0.5 h-4 min-w-4 items-center justify-center rounded-full bg-error px-1">
              <Text className="font-sans-bold text-[9px] text-on-brand">
                {unread > 9 ? '9+' : unread}
              </Text>
            </View>
          )}
        </View>
      </Pressable>

      <Pressable
        onPress={() => router.push('/more')}
        // No `className` — see note above.
        style={{ height: 40, width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999 }}
      >
        <Ionicons name="menu-outline" size={24} color={t.text} />
      </Pressable>

      {/* Business / location switcher */}
      <Modal
        visible={switcherOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSwitcherOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}
          onPress={() => setSwitcherOpen(false)}
        />
        <View className="max-h-[70%] rounded-t-3xl border-t border-surface-border bg-surface p-5 pb-8">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="font-display-bold text-lg text-white">Your businesses</Text>
            <Pressable
              onPress={() => setSwitcherOpen(false)}
              // No `className` — see note above.
              style={{ height: 36, width: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: t.overlay }}
            >
              <Ionicons name="close" size={18} color={t.textDim} />
            </Pressable>
          </View>
          <ScrollView>
            <BusinessSwitcher />
          </ScrollView>
        </View>
      </Modal>

      <InfoSheet
        visible={!!helpInfo}
        onClose={() => setHelpInfo(null)}
        title={helpInfo?.title ?? ''}
        message={helpInfo?.message ?? ''}
      />
    </View>
  );
}
