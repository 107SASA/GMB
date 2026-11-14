import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Linking, ScrollView, Text, View } from 'react-native';

import { fetchFreeReport } from '@/api/endpoints/freeReport';
import { useBusiness } from '@/business/BusinessContext';
import { MODULE_NAMES, SURFACE_MODULES, useEntitlements, type SurfaceKey } from '@/entitlements/entitlements';
import { FreeReportCard } from '@/components/free-report-card';
import { LockedPreview, previewCopy, type LockedPreviewKind } from '@/components/locked-previews';
import { Screen, SecondaryButton, useInfoSheet } from '@/components/ui';
import { ACTIVATE_MESSAGE, getSupportWhatsAppLink } from '@/lib/support';
import { useTheme, withAlpha } from '@/lib/theme';

/**
 * Full-screen locked state for a gated module.
 *
 * STORE COMPLIANCE — the copy here is deliberately neutral and final: no
 * price, no URL, no external-purchase steering, no "upgrade" wording.
 * Do not add anything beyond these two lines.
 */
/** `preview`: for Free CRM accounts, draw a sample of the unlocked screen behind the lock. */
export function LockedScreen({ surface, preview }: { surface: SurfaceKey; preview?: LockedPreviewKind }) {
  const moduleName = MODULE_NAMES[SURFACE_MODULES[surface]];
  const t = useTheme();
  const { freeCrm } = useBusiness();
  if (freeCrm) return <FreeCrmLockedScreen moduleName={surface === 'inbox' ? 'Inbox' : moduleName} preview={preview} />;
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
function FreeCrmLockedScreen({ moduleName, preview }: { moduleName: string; preview?: LockedPreviewKind }) {
  const t = useTheme();
  const router = useRouter();
  const info = useInfoSheet();
  const { activeBusiness, activeBusinessId } = useBusiness();
  // Same query as FreeReportCard (shared cache) — real numbers for the preview.
  const report = useQuery({ queryKey: ['free-report', activeBusinessId], queryFn: fetchFreeReport, enabled: !!activeBusinessId && !!preview });
  const businessName = activeBusiness?.name || 'your business';
  const copy = preview ? previewCopy(preview, businessName) : null;

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
      <View style={{ flex: 1 }}>
        {/* What this tab looks like when unlocked — faded, not touchable, labelled "Sample preview". */}
        {preview && (
          <>
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 56, opacity: 0.32 }} testID="locked-preview">
              <LockedPreview
                kind={preview}
                ctx={{ businessName, category: activeBusiness?.category ?? null, report: report.data?.report ?? null }}
              />
            </View>
            <LinearGradient
              pointerEvents="none"
              colors={[withAlpha(t.bg, 0.15), withAlpha(t.bg, 0.75), t.bg]}
              locations={[0, 0.45, 0.8]}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
          </>
        )}

        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: preview && preview !== 'home' ? 'flex-end' : 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 24 }}>
          {preview && (
            <View style={{ alignSelf: 'center', borderRadius: 999, borderWidth: 1, borderColor: t.border, backgroundColor: withAlpha(t.bg, 0.85), paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text className="font-sans-semibold text-xs text-zinc-400">Sample preview</Text>
            </View>
          )}
          {/* The free Google profile report (score, top fixes, full report) — Home only when previews are on. */}
          {(!preview || preview === 'home') && <FreeReportCard />}
          <View
            style={{
              alignItems: 'center',
              gap: 10,
              borderRadius: 18,
              borderWidth: preview ? 1 : 0,
              borderColor: t.border,
              backgroundColor: preview ? t.card : 'transparent',
              padding: preview ? 18 : 0,
            }}
          >
            <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-raised">
              <Ionicons name="lock-closed-outline" size={22} color={t.textFaint} />
            </View>
            <Text className="font-display-bold text-lg text-white">{copy?.title ?? moduleName}</Text>
            {copy && <Text className="text-center font-sans text-sm text-zinc-300">{copy.body}</Text>}
            <Text className="text-center font-sans text-sm text-zinc-400">
              This feature isn't included in your current plan. Your plan includes the CRM and visiting-card scan.
            </Text>
            <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 4 }}>
              <SecondaryButton title="Chat with us on WhatsApp" onPress={contactUs} />
              <SecondaryButton title="Open CRM" onPress={() => router.push('/leads')} />
            </View>
          </View>
        </ScrollView>
      </View>
      {info.node}
    </Screen>
  );
}
