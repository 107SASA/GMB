import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { cancelSubscription, fetchBillingStatus, fetchUsage } from '@/api/endpoints/account';
import { useBusiness } from '@/business/BusinessContext';
import { BillingBanner } from '@/components/locked';
import {
  Badge,
  EmptyState,
  ProgressBar,
  Screen,
  ScreenTitle,
  SectionLabel,
  Skeleton,
} from '@/components/ui';
import { ALL_MODULE_KEYS, MODULE_NAMES } from '@/entitlements/entitlements';
import { formatDateTime } from '@/lib/format';
import { useTheme } from '@/lib/theme';

function billingTone(status: string): 'positive' | 'info' | 'warning' | 'negative' | 'neutral' {
  if (status === 'Active') return 'positive';
  if (status === 'Trialing') return 'info';
  if (status === 'PastDue') return 'warning';
  if (status === 'Canceled') return 'negative';
  return 'neutral';
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  return (
    <View className="mb-3">
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="font-sans text-sm text-zinc-300">{label}</Text>
        <Text className="font-sans-semibold text-xs text-zinc-400">
          {used}/{limit}
        </Text>
      </View>
      <ProgressBar used={used} limit={limit} />
    </View>
  );
}

export default function BillingScreen() {
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const t = useTheme();

  const subscription = useQuery({ queryKey: ['billing-status'], queryFn: fetchBillingStatus });
  const usage = useQuery({
    queryKey: ['usage', activeBusinessId],
    queryFn: fetchUsage,
    enabled: !!activeBusinessId,
  });

  const cancel = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: ({ message }) => {
      Alert.alert('Subscription cancelled', message);
      // The webhook applies the downgrade at cycle end — give the server a
      // moment before refetching so cancelAtPeriodEnd is already flipped.
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['billing-status'] });
      }, 1500);
    },
    onError: (err) =>
      Alert.alert('Error', getApiErrorMessage(err, 'Could not cancel the subscription.')),
  });

  function confirmCancel() {
    Alert.alert(
      'Cancel subscription?',
      'You will keep full access until the end of your current billing period. It just won\'t renew after that.',
      [
        { text: 'Keep plan', style: 'cancel' },
        {
          text: 'Cancel subscription',
          style: 'destructive',
          onPress: () => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            cancel.mutate();
          },
        },
      ]
    );
  }

  const sub = subscription.data?.subscription;
  const workspace = subscription.data?.workspace;
  const enabledModules = ALL_MODULE_KEYS.filter((k) => sub?.modules[k]?.enabled);

  return (
    <Screen>
      <ScreenTitle>Billing</ScreenTitle>
      <BillingBanner />
      <ScrollView
        contentContainerClassName="px-5 pb-12"
        refreshControl={
          <RefreshControl
            refreshing={subscription.isRefetching || usage.isRefetching}
            onRefresh={() => {
              void subscription.refetch();
              void usage.refetch();
            }}
            tintColor={t.brandBright}
          />
        }
      >
        {subscription.isLoading ? (
          <Skeleton className="h-44" />
        ) : subscription.isError || !sub ? (
          <EmptyState
            title="Couldn't load your subscription"
            hint={getApiErrorMessage(subscription.error, 'Pull down to retry.')}
          />
        ) : (
          <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-display text-xl text-white">{sub.planType} plan</Text>
              <Badge label={sub.billingStatus} tone={billingTone(sub.billingStatus)} />
            </View>

            {sub.billingStatus === 'Trialing' && sub.trialStatus?.endsAt && (
              <Text className="mt-1.5 font-sans text-sm text-zinc-400">
                Trial ends {formatDateTime(sub.trialStatus.endsAt)}
              </Text>
            )}
            {(() => {
              const periodEnd = workspace?.currentPeriodEnd ?? sub.currentPeriodEnd;
              if (!periodEnd || sub.billingStatus !== 'Active') return null;
              if (workspace?.cancelAtPeriodEnd) {
                return (
                  <Text className="mt-1.5 font-sans-semibold text-sm text-amber-400">
                    Ends {formatDateTime(periodEnd)} — won&apos;t renew
                  </Text>
                );
              }
              return (
                <Text className="mt-1.5 font-sans text-sm text-zinc-400">Renews {formatDateTime(periodEnd)}</Text>
              );
            })()}

            {enabledModules.length > 0 && (
              <View className="mt-3 flex-row flex-wrap gap-2">
                {enabledModules.map((key) => (
                  <Badge key={key} label={MODULE_NAMES[key]} tone="info" />
                ))}
              </View>
            )}

            <View className="mt-4 flex-row gap-3">
              <Pressable
                onPress={() =>
                  void WebBrowser.openBrowserAsync(`${process.env.EXPO_PUBLIC_API_URL}/pricing`)
                }
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-brand py-3 active:scale-95"
              >
                <Ionicons name="open-outline" size={15} color="#ffffff" />
                <Text className="font-sans-bold text-sm text-on-brand">View plans on the web</Text>
              </Pressable>
              {sub.hasPaymentMethod &&
                sub.billingStatus !== 'Canceled' &&
                (workspace?.cancelAtPeriodEnd ? (
                  <View className="items-center justify-center rounded-full border border-surface-border px-4 py-3">
                    <Text className="font-sans-bold text-sm text-zinc-400">Cancellation scheduled</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={confirmCancel}
                    disabled={cancel.isPending}
                    className="items-center justify-center rounded-full border border-rose-400/25 px-4 py-3 active:scale-95"
                  >
                    <Text className="font-sans-bold text-sm text-rose-300">
                      {cancel.isPending ? 'Cancelling…' : 'Cancel'}
                    </Text>
                  </Pressable>
                ))}
            </View>
          </View>
        )}

        <SectionLabel>This month's usage</SectionLabel>
        {usage.isLoading ? (
          <Skeleton className="h-48" />
        ) : usage.isError || !usage.data ? (
          <Text className="px-1 font-sans text-sm text-zinc-500">Couldn't load usage.</Text>
        ) : (
          <View className="rounded-card border border-surface-border bg-surface-raised px-4 pb-1 pt-4">
            <UsageRow
              label="AI generations"
              used={usage.data.usage.aiGenerationsUsed}
              limit={usage.data.limits.maxAIGenerations}
            />
            <UsageRow
              label="Audits"
              used={usage.data.usage.auditsUsed}
              limit={usage.data.limits.maxAuditsPerBusiness}
            />
            <UsageRow
              label="Posts"
              used={usage.data.usage.postsUsed}
              limit={usage.data.limits.maxPostsPerMonth}
            />
            <UsageRow
              label="WhatsApp messages (today)"
              used={usage.data.usage.whatsappUsed}
              limit={usage.data.limits.maxWhatsAppMessagesPerDay}
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
