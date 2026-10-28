import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { useBusiness } from '@/business/BusinessContext';
import { BusinessSwitcher } from '@/components/business-switcher';
import { PrimaryButton, Screen, SecondaryButton, SectionLabel, useInfoSheet } from '@/components/ui';
import { getSupportWhatsAppLink } from '@/lib/support';
import { useTheme } from '@/lib/theme';

/**
 * Must match APP_ACCESS_MESSAGE in the web's src/lib/whatsappCta.ts exactly:
 * the webhook recognises it and replies with the fixed "complete your
 * payment and the dashboard unlocks" message (services/whatsapp/appAccessHelp.ts).
 */
export const ACTIVATE_MESSAGE = "Hi, I'm not able to access my GrowwMatics dashboard in the app";

/**
 * Shown instead of onboarding and the tabs when the active workspace has no
 * paid plan or trial — e.g. the account a free report or demo booking
 * creates. The web blurs the dashboard behind a subscribe overlay instead.
 *
 * STORE COMPLIANCE — same rule as components/locked.tsx: no price, no URL,
 * no external-purchase steering, no "upgrade" wording. The only way forward
 * offered here is talking to the team on WhatsApp.
 */
const COPY = {
  unpaid: { title: "Your workspace isn't active yet" },
  payment_failed: { title: 'Your workspace is paused' },
  ended: { title: 'Your workspace is no longer active' },
} as const;

export function WorkspaceInactiveScreen() {
  const { businesses, activeBusiness, workspaceLockReason, refreshWorkspaceAccess } = useBusiness();
  const copy = COPY[workspaceLockReason ?? 'unpaid'];
  const { logout } = useAuth();
  const t = useTheme();
  const info = useInfoSheet();
  const [checking, setChecking] = useState(false);

  function contactUs() {
    const link = getSupportWhatsAppLink(ACTIVATE_MESSAGE);
    if (!link) {
      info.show('Contact us', 'Reach us at support@growwmatics.com and our team will get you started.');
      return;
    }
    Linking.openURL(link).catch(() =>
      info.show(
        'Could not open WhatsApp',
        'Make sure WhatsApp is installed, then try again — or reach us at support@growwmatics.com.'
      )
    );
  }

  async function checkAgain() {
    setChecking(true);
    try {
      await refreshWorkspaceAccess();
    } finally {
      setChecking(false);
    }
  }

  return (
    <Screen safeBottom>
      <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-10">
        <View className="items-center gap-3">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-raised">
            <Ionicons name="pause-circle-outline" size={30} color={t.textFaint} />
          </View>
          {activeBusiness?.name ? (
            <Text className="text-center font-sans-semibold text-xs uppercase tracking-wider text-zinc-500">
              {activeBusiness.name}
            </Text>
          ) : null}
          <Text className="text-center font-display-bold text-xl text-white">{copy.title}</Text>
          <Text className="text-center font-sans text-sm leading-5 text-zinc-400">
            Need help getting in? Message us on WhatsApp and we&apos;ll sort it out.
          </Text>
        </View>

        <View className="mt-8 gap-3">
          <PrimaryButton title="Get help on WhatsApp" onPress={contactUs} />
          <SecondaryButton
            title={checking ? 'Checking…' : 'Check again'}
            onPress={() => void checkAgain()}
            disabled={checking}
          />
        </View>

        {businesses.length > 1 && (
          <View className="mt-8">
            <SectionLabel>Your workspaces</SectionLabel>
            <BusinessSwitcher />
          </View>
        )}

        <Pressable
          onPress={() => void logout()}
          // No `className` — react-native-css-interop can swallow onPress on
          // styled Pressables (see components/ui.tsx).
          style={{ alignSelf: 'center', marginTop: 28, paddingVertical: 8, paddingHorizontal: 12 }}
          hitSlop={6}
        >
          <Text className="font-sans-semibold text-sm text-zinc-500">Sign out</Text>
        </Pressable>
      </ScrollView>
      {info.node}
    </Screen>
  );
}
