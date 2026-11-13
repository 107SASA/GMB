import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Linking, ScrollView, Text, View } from 'react-native';

import { useBusiness } from '@/business/BusinessContext';
import { MODULE_NAMES, SURFACE_MODULES, useEntitlements, type SurfaceKey } from '@/entitlements/entitlements';
import { FreeReportCard } from '@/components/free-report-card';
import { Screen, SecondaryButton, useInfoSheet } from '@/components/ui';
import { ACTIVATE_MESSAGE, getSupportWhatsAppLink } from '@/lib/support';
import { useTheme } from '@/lib/theme';

/**
 * Full-screen locked state for a gated module.
 *
 * STORE COMPLIANCE — the copy here is deliberately neutral and final: no
 * price, no URL, no external-purchase steering, no "upgrade" wording.
 * Do not add anything beyond these two lines.
 */
export function LockedScreen({ surface }: { surface: SurfaceKey }) {
  const moduleName = MODULE_NAMES[SURFACE_MODULES[surface]];
  const t = useTheme();
  const { freeCrm } = useBusiness();
  if (freeCrm) return <FreeCrmLockedScreen moduleName={surface === 'inbox' ? 'Inbox' : moduleName} />;
  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-3 px-10">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-raised">
          <Ionicons name="lock-closed-outline" size={28} color={t.textFaint} />
        </View>
        <Text className="font-display-bold text-lg text-white">{moduleName}</Text>
        <Text className="text-center font-sans text-sm text-zinc-400">
          This feature isn't included in your current plan.
        </Text>
        <Text className="text-center font-sans text-xs text-zinc-500">
          Contact support for details.
        </Text>
      </View>
    </Screen>
  );
}

/**
 * Small non-blocking banner for trial/billing edge states. Neutral copy
 * only — no payment links (store compliance).
 */
export function BillingBanner() {
  const { isTrialing, trialDaysLeft, isPastDue } = useEntitlements();
  const t = useTheme();

  if (isPastDue) {
    return (
      <View className="mx-5 mb-2 flex-row items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3.5 py-2.5">
        <Ionicons name="alert-circle-outline" size={16} color={t.amber} />
        <Text className="flex-1 font-sans-semibold text-xs text-amber-400">
          There's a billing issue on your account.
        </Text>
      </View>
    );
  }

  if (isTrialing && trialDaysLeft > 0) {
    return (
      <View className="mx-5 mb-2 flex-row items-center gap-2 rounded-xl border border-indigo-400/20 bg-indigo-400/10 px-3.5 py-2.5">
        <Ionicons name="time-outline" size={16} color={t.brand} />
        <Text className="flex-1 font-sans-semibold text-xs text-indigo-300">
          Trial ends in {trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'}
        </Text>
      </View>
    );
  }

  return null;
}

/**
 * Free CRM tier (unpaid workspace): every tab except the CRM is locked.
 * STORE COMPLIANCE — neutral copy, no price, no "upgrade/buy", no pricing
 * link. The WhatsApp button reuses the "workspace inactive" screen's message,
 * so the existing WhatsApp auto-reply handles it (services/whatsapp/appAccessHelp.ts).
 */
function FreeCrmLockedScreen({ moduleName }: { moduleName: string }) {
  const t = useTheme();
  const router = useRouter();
  const info = useInfoSheet();

  function contactUs() {
    const link = getSupportWhatsAppLink(ACTIVATE_MESSAGE);
    if (!link) {
      info.show('Contact us', 'Reach us at support@growwmatics.com and our team will help you.');
      return;
    }
    Linking.openURL(link).catch(() =>
      info.show('Could not open WhatsApp', 'Make sure WhatsApp is installed, then try again — or reach us at support@growwmatics.com.')
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 24 }}>
        {/* The free Google profile report (score, top fixes, full report). */}
        <FreeReportCard />
        <View className="items-center gap-3">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-surface-raised">
            <Ionicons name="lock-closed-outline" size={24} color={t.textFaint} />
          </View>
          <Text className="font-display-bold text-lg text-white">{moduleName}</Text>
          <Text className="text-center font-sans text-sm text-zinc-400">
            This feature isn't included in your current plan. Your plan includes the CRM and visiting-card scan.
          </Text>
        </View>
        <View style={{ gap: 10 }}>
          <SecondaryButton title="Open CRM" onPress={() => router.push('/leads')} />
          <SecondaryButton title="Chat with us on WhatsApp" onPress={contactUs} />
        </View>
      </ScrollView>
      {info.node}
    </Screen>
  );
}
