import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { MODULE_NAMES, SURFACE_MODULES, useEntitlements, type SurfaceKey } from '@/entitlements/entitlements';
import { Screen } from '@/components/ui';
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
  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-3 px-10">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-raised">
          <Ionicons name="lock-closed-outline" size={28} color={t.textFaint} />
        </View>
        <Text className="text-lg font-semibold text-white">{moduleName}</Text>
        <Text className="text-center text-sm text-zinc-400">
          This feature isn't included in your current plan.
        </Text>
        <Text className="text-center text-xs text-zinc-500">Contact support for details.</Text>
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
        <Text className="flex-1 text-xs text-amber-400">
          There's a billing issue on your account.
        </Text>
      </View>
    );
  }

  if (isTrialing && trialDaysLeft > 0) {
    return (
      <View className="mx-5 mb-2 flex-row items-center gap-2 rounded-xl border border-indigo-400/20 bg-indigo-400/10 px-3.5 py-2.5">
        <Ionicons name="time-outline" size={16} color={t.brand} />
        <Text className="flex-1 text-xs text-indigo-300">
          Trial ends in {trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'}
        </Text>
      </View>
    );
  }

  return null;
}
