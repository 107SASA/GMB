import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { fetchFreeReport } from '@/api/endpoints/freeReport';
import { useBusiness } from '@/business/BusinessContext';
import { MODULE_NAMES, SURFACE_MODULES, useEntitlements, useSurfaceLocked, type SurfaceKey } from '@/entitlements/entitlements';
import { FreeReportCard } from '@/components/free-report-card';
import { LockedPreview, previewCopy, type LockedPreviewKind } from '@/components/locked-previews';
import { Screen, useInfoSheet } from '@/components/ui';
import { ACTIVATE_MESSAGE, getSupportWhatsAppLink } from '@/lib/support';
import { BRAND_GRADIENT, useTheme, withAlpha } from '@/lib/theme';

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
        <LockCircle />
        <Text className="font-display-bold text-lg" style={{ color: t.text }}>{moduleName}</Text>
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

/** "Premium" pill shown next to locked features (More menu, Home cards). Neutral wording — no price. */
export function PremiumBadge() {
  const t = useTheme();
  return (
    <View style={{ borderRadius: 999, backgroundColor: withAlpha(t.amber, 0.18), borderWidth: 1, borderColor: withAlpha(t.amber, 0.35), paddingHorizontal: 9, paddingVertical: 2 }}>
      <Text className="font-sans-bold text-[11px]" style={{ color: t.amber }}>Premium</Text>
    </View>
  );
}

/** Round lock badge used on every locked card. */
function LockCircle({ size = 64 }: { size?: number }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.card,
        borderWidth: 1,
        borderColor: withAlpha(t.brand, 0.35),
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      }}
    >
      <Ionicons name="lock-closed-outline" size={size * 0.44} color={t.brandBright} />
    </View>
  );
}

/** Opens the WhatsApp chat our auto-reply handles (services/whatsapp/appAccessHelp.ts). */
export function useContactUs() {
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
  return { contactUs, node: info.node };
}

/** Green pill CTA with the WhatsApp icon — same gradient as PrimaryButton. */
function WhatsAppButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // No `className` on Pressable — see ui.tsx PrimaryButton.
      style={{ alignSelf: 'stretch', overflow: 'hidden', borderRadius: 999 }}
    >
      <LinearGradient
        colors={[...BRAND_GRADIENT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50, paddingHorizontal: 20 }}
      >
        <Ionicons name="logo-whatsapp" size={18} color="#ffffff" />
        <Text className="font-sans-bold text-base" style={{ color: '#ffffff' }}>Chat with us on WhatsApp</Text>
      </LinearGradient>
    </Pressable>
  );
}

/**
 * Locked feature card for Home / More — lock, title, "Premium" badge, one
 * line, and the WhatsApp button. STORE COMPLIANCE: no price / buy wording.
 */
export function LockedFeatureCard({
  title,
  body,
  icon = 'lock-closed-outline',
  hero = false,
}: {
  title: string;
  body: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Bigger, centered layout (bottom of the More menu). */
  hero?: boolean;
}) {
  const t = useTheme();
  const { contactUs, node } = useContactUs();
  if (hero) {
    return (
      <View style={{ alignItems: 'center', gap: 10, borderRadius: 22, borderWidth: 1, borderColor: withAlpha(t.brand, 0.3), backgroundColor: withAlpha(t.brand, 0.08), padding: 20 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: t.brand }}>
          <Ionicons name={icon} size={26} color="#ffffff" />
        </View>
        <Text className="text-center font-display-bold text-lg" style={{ color: t.text }}>{title}</Text>
        <Text className="text-center font-sans text-sm" style={{ color: t.textDim }}>{body}</Text>
        <View style={{ alignSelf: 'stretch', marginTop: 4 }}>
          <WhatsAppButton onPress={contactUs} />
        </View>
        {node}
      </View>
    );
  }
  return (
    <View style={{ gap: 14, borderRadius: 22, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, padding: 16 }}>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(t.brand, 0.14) }}>
          <Ionicons name="lock-closed-outline" size={24} color={t.brandBright} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text className="flex-1 font-display-bold text-base" style={{ color: t.text }} numberOfLines={2}>{title}</Text>
            <PremiumBadge />
          </View>
          <Text className="font-sans text-sm" style={{ color: t.textDim }}>{body}</Text>
        </View>
      </View>
      <WhatsAppButton onPress={contactUs} />
      {node}
    </View>
  );
}

/**
 * Home: one card per feature this workspace doesn't have (e.g. its plan has
 * no review automation). Nothing shows when everything is included.
 */
export function HomeLockedCards() {
  const reviewsLocked = useSurfaceLocked('reviews');
  const postsLocked = useSurfaceLocked('scheduler');
  if (!reviewsLocked && !postsLocked) return null;
  return (
    <View style={{ marginHorizontal: 16, marginTop: 16, gap: 12 }}>
      {reviewsLocked && (
        <LockedFeatureCard title="Review Automation" body="Automatically send review requests, follow-ups and grow your reviews on Google." />
      )}
      {postsLocked && (
        <LockedFeatureCard title="Google Posts" body="We write, design and publish posts on your Google profile every week." />
      )}
    </View>
  );
}

/**
 * Free CRM tier (unpaid workspace): every tab except the CRM is locked.
 * The tab's sample screen (components/locked-previews.tsx) is drawn behind,
 * blurred, with a lock card on top.
 * STORE COMPLIANCE — neutral copy, no price, no "upgrade/buy", no pricing
 * link. The WhatsApp button reuses the "workspace inactive" screen's message,
 * so the existing WhatsApp auto-reply handles it (services/whatsapp/appAccessHelp.ts).
 */
function FreeCrmLockedScreen({ moduleName, preview }: { moduleName: string; preview?: LockedPreviewKind }) {
  const t = useTheme();
  const router = useRouter();
  const { contactUs, node } = useContactUs();
  const { activeBusiness, activeBusinessId } = useBusiness();
  // Same query as FreeReportCard (shared cache).
  const report = useQuery({ queryKey: ['free-report', activeBusinessId], queryFn: fetchFreeReport, enabled: !!activeBusinessId && !!preview });
  const businessName = activeBusiness?.name || 'your business';
  const copy = preview ? previewCopy(preview, businessName) : null;

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {/* What this tab looks like when unlocked — a sample, blurred, not touchable, labelled "Sample preview". */}
        {preview && (
          <>
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 52, opacity: 0.55 }} testID="locked-preview">
              <LockedPreview
                kind={preview}
                ctx={{ businessName, category: activeBusiness?.category ?? null, report: report.data?.report ?? null }}
              />
            </View>
            <LinearGradient
              pointerEvents="none"
              colors={[withAlpha(t.bg, 0.05), withAlpha(t.bg, 0.55), withAlpha(t.bg, 0.92)]}
              locations={[0, 0.4, 0.85]}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
          </>
        )}

        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: preview && preview !== 'home' ? 'flex-end' : 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 20 }}>
          {/* The free Google profile report (score, top fixes, full report) — Home only when previews are on. */}
          {(!preview || preview === 'home') && <FreeReportCard />}
          <View
            style={{
              alignItems: 'center',
              gap: 10,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: t.border,
              backgroundColor: withAlpha(t.card, 0.97),
              paddingHorizontal: 20,
              paddingTop: 22,
              paddingBottom: 18,
              shadowColor: '#000',
              shadowOpacity: 0.2,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 8 },
              elevation: 6,
            }}
          >
            <LockCircle />
            <Text className="mt-1 text-center font-display-bold text-xl" style={{ color: t.text }}>{copy?.title ?? moduleName}</Text>
            {copy && <Text className="text-center font-sans text-sm leading-5" style={{ color: t.textDim }}>{copy.body}</Text>}
            <Text className="text-center font-sans text-xs leading-4" style={{ color: t.textFaint }}>
              This feature isn't included in your current plan. Your plan includes the CRM and visiting-card scan.
            </Text>
            <View style={{ alignSelf: 'stretch', marginTop: 6 }}>
              <WhatsAppButton onPress={contactUs} />
            </View>
            <Pressable onPress={() => router.push('/leads')} hitSlop={8} accessibilityRole="button" style={{ paddingVertical: 6 }}>
              <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>Open CRM</Text>
            </Pressable>
          </View>
        </ScrollView>
        {preview && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 12, left: 0, right: 0, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1, borderColor: t.border, backgroundColor: withAlpha(t.card, 0.92), paddingHorizontal: 12, paddingVertical: 5 }}>
              <Ionicons name="eye-outline" size={13} color={t.textDim} />
              <Text className="font-sans-semibold text-xs" style={{ color: t.textDim }}>Sample preview</Text>
            </View>
          </View>
        )}
      </View>
      {node}
    </Screen>
  );
}
