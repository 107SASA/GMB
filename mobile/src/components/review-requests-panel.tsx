import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { addCustomer, fetchCustomers, sendReviewRequest, type Customer } from '@/api/endpoints/customers';
import { fetchDashboardStats } from '@/api/endpoints/dashboard';
import { fetchReviewRequests, type ReviewRequestOverview } from '@/api/endpoints/review-requests';
import { fetchReviews } from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import { ContactPickerModal } from '@/components/contact-picker-modal';
import { Badge, EmptyState, Field, LabeledField, PrimaryButton, Skeleton, useInfoSheet } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useTheme } from '@/lib/theme';

type Summary = ReviewRequestOverview['latestByCustomer'][string];

const REQUEST_METRICS: {
  key: 'reviewRequests' | 'delivered' | 'read' | 'clicked' | 'failed';
  label: string;
  hint: string;
}[] = [
  { key: 'reviewRequests', label: 'Review Requests', hint: 'Total requests sent' },
  { key: 'delivered', label: 'Delivered', hint: 'Successfully delivered' },
  { key: 'read', label: 'Read', hint: 'Messages read' },
  { key: 'clicked', label: 'Clicked', hint: 'Customers who clicked the review link' },
  { key: 'failed', label: 'Failed', hint: 'Requests that could not be delivered' },
];

function displayStatus(label?: string | null): string {
  if (label === 'Failed') return 'Unable to deliver';
  return label || 'Pending';
}

function statusTone(label: string): 'neutral' | 'positive' | 'negative' | 'warning' | 'info' {
  if (label === 'Unable to deliver') return 'negative';
  if (label === 'Clicked' || label === 'Read' || label === 'Delivered') return 'positive';
  if (label === 'Sent') return 'info';
  if (label === 'Pending') return 'warning';
  return 'neutral';
}

function when(value?: string | null): string {
  return formatDateTime(value) || '—';
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <View style={{ width: '48%' }} className="rounded-card border border-surface-border bg-surface-raised px-3.5 py-3">
      <Text className="font-sans text-xs text-zinc-400">{label}</Text>
      <Text className="mt-1 font-display text-2xl text-white">{value}</Text>
      <Text className="mt-1 font-sans text-[11px] leading-4 text-zinc-500">{hint}</Text>
    </View>
  );
}

function Stamp({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '48%' }} className="mb-2">
      <Text className="font-sans text-[11px] text-zinc-500">{label}</Text>
      <Text className="mt-0.5 font-sans text-xs text-zinc-200">{value}</Text>
    </View>
  );
}

function RequestCard({
  customer,
  summary,
  sending,
  onSend,
}: {
  customer: Customer;
  summary?: Summary;
  sending: boolean;
  onSend: () => void;
}) {
  const t = useTheme();
  const status = displayStatus(summary?.statusLabel);
  const canSend = !customer.optedOut && !!customer.phone && (customer.reviewStatus === 'Pending' || customer.reviewStatus === 'Failed');

  return (
    <View
      style={{
        marginBottom: 12,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.card,
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      <View className="flex-row items-start gap-3">
        <View className="flex-1">
          <Text className="font-sans-semibold text-base text-white" numberOfLines={1}>
            {customer.name || 'Customer'}
          </Text>
          <Text className="mt-0.5 font-sans text-xs text-zinc-400">{customer.phone || 'No phone number'}</Text>
        </View>
        <Badge label={status} tone={statusTone(status)} />
      </View>
      {customer.optedOut && (
        <View className="mt-2">
          <Badge label="Opted out" tone="negative" />
        </View>
      )}
      <View className="mt-3 flex-row flex-wrap">
        <Stamp label="Sent" value={when(summary?.sentAt)} />
        <Stamp label="Delivered" value={when(summary?.deliveredAt)} />
        <Stamp label="Read" value={when(summary?.readAt)} />
        <Stamp label="Clicked" value={when(summary?.clickedAt)} />
        <Stamp label="Last request" value={when(summary?.lastRequestAt)} />
        <Stamp label="Follow-up" value={summary?.followUpLabel || '—'} />
      </View>
      {canSend && (
        <Pressable
          onPress={onSend}
          disabled={sending}
          style={{
            marginTop: 8,
            alignSelf: 'flex-start',
            borderRadius: 999,
            backgroundColor: t.brand,
            paddingHorizontal: 14,
            paddingVertical: 8,
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text className="font-sans-bold text-sm text-on-brand">Send Review Request</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

/**
 * Business review-request reporting. Counts come from GET /api/review-requests.
 * Google Reviews comes from the existing Google review total, never from clicks.
 */
export function ReviewRequestsPanel() {
  const t = useTheme();
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const info = useInfoSheet();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [duplicate, setDuplicate] = useState<Extract<Awaited<ReturnType<typeof addCustomer>>, { created: false }> | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const requests = useQuery({
    queryKey: ['review-requests', activeBusinessId],
    queryFn: fetchReviewRequests,
    enabled: !!activeBusinessId,
  });
  const stats = useQuery({
    queryKey: ['dashboard-stats', activeBusinessId],
    queryFn: () => fetchDashboardStats(30),
    enabled: !!activeBusinessId,
  });
  const reviews = useQuery({
    queryKey: ['reviews', activeBusinessId],
    queryFn: fetchReviews,
    enabled: !!activeBusinessId && stats.isError,
  });
  const customers = useInfiniteQuery({
    queryKey: ['review-customers', activeBusinessId, search],
    queryFn: ({ pageParam }) => fetchCustomers(pageParam, search),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: !!activeBusinessId,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['review-requests', activeBusinessId] }),
      queryClient.invalidateQueries({ queryKey: ['review-customers', activeBusinessId] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusinessId] }),
      queryClient.invalidateQueries({ queryKey: ['reviews', activeBusinessId] }),
    ]);
  };

  const add = useMutation({
    mutationFn: () => addCustomer({ name: name.trim(), phone: phone.trim() }),
    onSuccess: async (result) => {
      if (!result.created) {
        setDuplicate(result);
        return;
      }
      setDuplicate(null);
      setName('');
      setPhone('');
      await refresh();
      info.show('Customer added', `${result.customer.name || 'Customer'} is ready for a review request.`);
    },
    onError: (error) => info.show('Could not add customer', getApiErrorMessage(error, 'Please try again.')),
  });

  const send = useMutation({
    mutationFn: (customerId: string) => sendReviewRequest(customerId),
    onMutate: (customerId) => setSendingId(customerId),
    onSuccess: async () => {
      setDuplicate(null);
      setName('');
      setPhone('');
      await refresh();
      info.show('Review request sent', 'The WhatsApp review request is on its way.');
    },
    onError: (error) => info.show('Could not send', getApiErrorMessage(error, 'Please try again.')),
    onSettled: () => setSendingId(null),
  });

  const rows = customers.data?.pages.flatMap((page) => page.customers) ?? [];
  const latest = requests.data?.latestByCustomer ?? {};
  const metrics = requests.data?.metrics;
  const googleReviews = stats.data?.metrics.totalReviews ?? (reviews.data ? reviews.data.length : null);
  const loading = requests.isLoading || customers.isLoading;

  return (
    <>
      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <RequestCard
            customer={item}
            summary={latest[item._id]}
            sending={sendingId === item._id}
            onSend={() => send.mutate(item._id)}
          />
        )}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={requests.isRefetching || customers.isRefetching}
            onRefresh={() => void refresh()}
            tintColor={t.brandBright}
          />
        }
        onEndReached={() => {
          if (customers.hasNextPage && !customers.isFetchingNextPage) void customers.fetchNextPage();
        }}
        ListHeaderComponent={
          <View className="pb-2 pt-1">
            {requests.isLoading ? (
              <Skeleton className="mb-4 h-40 rounded-card" />
            ) : requests.isError ? (
              <EmptyState title="Couldn't load review requests" hint={getApiErrorMessage(requests.error, 'Pull down to retry.')} />
            ) : (
              <View className="mb-4 flex-row flex-wrap justify-between gap-y-3">
                {REQUEST_METRICS.map((metric) => (
                  <MetricCard
                    key={metric.key}
                    label={metric.label}
                    value={String(metrics?.[metric.key] ?? 0)}
                    hint={metric.hint}
                  />
                ))}
                <MetricCard
                  label="Google Reviews"
                  value={googleReviews == null ? '—' : String(googleReviews)}
                  hint="Received on Google"
                />
              </View>
            )}

            <View className="mb-4 rounded-card border border-surface-border bg-surface-raised px-4 py-4">
              <Text className="mb-3 font-display-bold text-base text-white">Add a customer</Text>
              <LabeledField label="Name" value={name} onChangeText={setName} placeholder="Customer name" />
              <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">Phone</Text>
              <View className="mb-3 flex-row gap-3">
                <View className="flex-1">
                  <Field value={phone} onChangeText={setPhone} placeholder="Phone number" keyboardType="phone-pad" />
                </View>
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  accessibilityLabel="Choose a contact"
                  style={{
                    height: 52,
                    width: 52,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: t.border,
                    backgroundColor: t.card,
                  }}
                >
                  <Ionicons name="people-outline" size={22} color={t.brandBright} />
                </Pressable>
              </View>
              <PrimaryButton
                title="Add Customer"
                onPress={() => {
                  setDuplicate(null);
                  add.mutate();
                }}
                loading={add.isPending}
                disabled={name.trim().length < 1 || phone.trim().length < 7}
              />
              {duplicate && (
                <View className="mt-3 rounded-2xl border border-surface-border bg-surface px-3.5 py-3">
                  <Text className="font-sans-semibold text-sm text-white">Customer already exists</Text>
                  {!!duplicate.reason && (
                    <Text className="mt-1 font-sans text-xs text-zinc-400">{duplicate.reason}</Text>
                  )}
                  {duplicate.canSend && duplicate.customerId && (
                    <View className="mt-3">
                      <PrimaryButton
                        title="Send Review Request"
                        onPress={() => send.mutate(duplicate.customerId!)}
                        loading={sendingId === duplicate.customerId}
                      />
                    </View>
                  )}
                </View>
              )}
            </View>

            <Field value={searchInput} onChangeText={setSearchInput} placeholder="Search customers" />
            <View className="h-3" />
            {loading && (
              <View className="gap-3">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
              </View>
            )}
            {customers.isError && !loading && (
              <EmptyState title="Couldn't load customers" hint={getApiErrorMessage(customers.error, 'Pull down to retry.')} />
            )}
          </View>
        }
        ListEmptyComponent={
          loading || customers.isError ? null : (
            <EmptyState
              title={search ? 'No matching customers' : 'No customers yet'}
              hint={search ? 'Try a different name or phone number.' : 'Add a customer to send a WhatsApp review request.'}
            />
          )
        }
        ListFooterComponent={
          customers.isFetchingNextPage ? (
            <ActivityIndicator color={t.brandBright} style={{ marginVertical: 12 }} />
          ) : null
        }
      />
      <ContactPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(contact) => {
          setPhone(contact.phone);
          if (!name.trim() && contact.name) setName(contact.name);
          setPickerOpen(false);
        }}
      />
      {info.node}
    </>
  );
}
