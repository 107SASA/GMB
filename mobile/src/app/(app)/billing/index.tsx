import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
        <Text className="text-sm text-zinc-300">{label}</Text>
        <Text className="text-xs font-semibold text-zinc-400">
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

  const subscription = useQuery({ queryKey: ['billing-status'], queryFn: fetchBillingStatus });
  const usage = useQuery({
    queryKey: ['usage', activeBusinessId],
    queryFn: fetchUsage,
    enabled: !!activeBusinessId,
  });

  const cancel = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: () => {
      Alert.alert(
        'Cancellation requested',
        'Your subscription will be cancelled shortly. This can take a minute to reflect.'
      );
      // The webhook applies the downgrade — give it a moment before refetching.
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['billing-status'] });
      }, 3000);
    },
    onError: (err) =>
      Alert.alert('Error', getApiErrorMessage(err, 'Could not cancel the subscription.')),
  });

  function confirmCancel() {
    Alert.alert(
      'Cancel subscription?',
      'You will lose access to paid modules at the end of the current period.',
      [
        { text: 'Keep plan', style: 'cancel' },
        { text: 'Cancel subscription', style: 'destructive', onPress: () => cancel.mutate() },
      ]
    );
  }

  const sub = subscription.data;
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
            tintColor="#6366F1"
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
          <View className="rounded-xl border border-surface-border bg-surface-raised px-4 py-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-xl font-bold text-white">{sub.planType} plan</Text>
              <Badge label={sub.billingStatus} tone={billingTone(sub.billingStatus)} />
            </View>

            {sub.billingStatus === 'Trialing' && sub.trialStatus?.endsAt && (
              <Text className="mt-1.5 text-sm text-zinc-400">
                Trial ends {formatDateTime(sub.trialStatus.endsAt)}
              </Text>
            )}
            {!!sub.currentPeriodEnd && sub.billingStatus === 'Active' && (
              <Text className="mt-1.5 text-sm text-zinc-400">
                Renews {formatDateTime(sub.currentPeriodEnd)}
              </Text>
            )}

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
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-brand py-3 active:opacity-80"
              >
                <Ionicons name="open-outline" size={15} color="#ffffff" />
                <Text className="text-sm font-semibold text-on-brand">View plans on the web</Text>
              </Pressable>
              {sub.hasPaymentMethod && sub.billingStatus !== 'Canceled' && (
                <Pressable
                  onPress={confirmCancel}
                  disabled={cancel.isPending}
                  className="items-center justify-center rounded-xl border border-rose-400/25 px-4 py-3 active:opacity-80"
                >
                  <Text className="text-sm font-semibold text-rose-300">
                    {cancel.isPending ? 'Cancelling…' : 'Cancel'}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        <SectionLabel>This month's usage</SectionLabel>
        {usage.isLoading ? (
          <Skeleton className="h-48" />
        ) : usage.isError || !usage.data ? (
          <Text className="px-1 text-sm text-zinc-500">Couldn't load usage.</Text>
        ) : (
          <View className="rounded-xl border border-surface-border bg-surface-raised px-4 pb-1 pt-4">
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
