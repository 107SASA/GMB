import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { actOnCall, fetchCalls, type CallAction, type CallEvent } from '@/api/endpoints/crm';
import { fetchLeads } from '@/api/endpoints/leads';
import { useBusiness } from '@/business/BusinessContext';
import { BackChevron, EmptyState, ErrorText, Field, Screen, Skeleton } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/**
 * Calls reported by the business's call-tracking provider (Twilio number on
 * the Google profile). A caller who is already a lead is linked
 * automatically; anyone else waits here for the owner to decide:
 * Save as Lead / Existing Lead / Dismiss. Nothing is ever sent to the caller.
 *
 * This is server-side call data — no READ_CALL_LOG permission, works on iOS
 * and Android. (Reading the phone's own call log stays unimplemented: Google
 * Play restricts READ_CALL_LOG and iOS offers no call-log access at all.)
 */

function ActionButton({ label, primary, onPress, disabled }: { label: string; primary?: boolean; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: primary ? t.brand : t.border,
        backgroundColor: primary ? t.brand : 'transparent',
        paddingHorizontal: 12,
        paddingVertical: 7,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text className={`font-sans-semibold text-xs ${primary ? 'text-on-brand' : 'text-zinc-300'}`}>{label}</Text>
    </Pressable>
  );
}

function stateLabel(c: CallEvent): string {
  if (c.leadState === 'existing_lead') return c.leadId ? `Lead: ${c.leadId.name}` : 'Existing lead';
  if (c.leadState === 'saved') return c.leadId ? `Saved: ${c.leadId.name}` : 'Saved as lead';
  if (c.leadState === 'dismissed') return 'Dismissed';
  return 'Not saved';
}

export default function RecentCallsScreen() {
  const router = useRouter();
  const t = useTheme();
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const { callEventId } = useLocalSearchParams<{ callEventId?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [linkSearch, setLinkSearch] = useState('');

  const calls = useQuery({
    queryKey: ['crm-calls', activeBusinessId],
    queryFn: () => fetchCalls(false),
    enabled: !!activeBusinessId,
  });
  const leads = useQuery({
    queryKey: ['crm-leads', activeBusinessId],
    queryFn: fetchLeads,
    enabled: !!activeBusinessId && !!linkFor,
  });

  const act = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CallAction }) => actOnCall(id, body),
    onMutate: () => setError(null),
    onSuccess: () => {
      setLinkFor(null);
      void queryClient.invalidateQueries({ queryKey: ['crm-calls', activeBusinessId] });
      void queryClient.invalidateQueries({ queryKey: ['crm-calls-pending', activeBusinessId] });
      void queryClient.invalidateQueries({ queryKey: ['crm-leads', activeBusinessId] });
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Something went wrong.')),
  });

  const linkOptions = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    return (leads.data ?? [])
      .filter((l) => !q || [l.name, l.phone].some((v) => v?.toLowerCase().includes(q)))
      .slice(0, 50);
  }, [leads.data, linkSearch]);

  return (
    <Screen>
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <BackChevron />
        </Pressable>
        <Text className="font-display-bold text-lg text-white">Calls</Text>
      </View>

      {!!error && (
        <View className="px-5 pt-3">
          <ErrorText>{error}</ErrorText>
        </View>
      )}

      {calls.isLoading ? (
        <View className="gap-3 p-5">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </View>
      ) : (
        <FlatList
          data={calls.data?.calls ?? []}
          keyExtractor={(c) => c._id}
          contentContainerStyle={{ padding: 20, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={calls.isRefetching} onRefresh={() => void calls.refetch()} tintColor={t.brandBright} />
          }
          ListEmptyComponent={
            <EmptyState
              title="No calls yet"
              hint={
                calls.isError
                  ? getApiErrorMessage(calls.error, 'Pull down to retry.')
                  : 'Calls to your connected call-tracking number appear here. Use "Log a call" for calls made from your own phone.'
              }
            />
          }
          renderItem={({ item: c }) => {
            const pending = c.leadState === 'pending' && c.direction === 'inbound';
            const highlighted = c._id === callEventId;
            return (
              <View
                style={{
                  marginBottom: 12,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: highlighted ? t.brand : t.border,
                  backgroundColor: t.card,
                  padding: 14,
                }}
              >
                <View className="flex-row items-center gap-3">
                  <Ionicons
                    name={c.outcome === 'missed' ? 'call-outline' : c.direction === 'inbound' ? 'arrow-down-outline' : 'arrow-up-outline'}
                    size={18}
                    color={c.outcome === 'missed' ? '#f87171' : t.brandBright}
                  />
                  <View className="flex-1">
                    <Text className="font-sans-semibold text-base text-white">{c.callerName || c.phone}</Text>
                    <Text className="font-sans text-xs text-zinc-500">
                      {c.callerName ? `${c.phone} · ` : ''}
                      {c.outcome === 'missed' ? 'Missed · ' : ''}
                      {formatDateTime(c.startedAt)}
                    </Text>
                  </View>
                  <Text className="font-sans text-xs text-zinc-400">{stateLabel(c)}</Text>
                </View>
                {pending && (
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    <ActionButton
                      primary
                      label="Save as Lead"
                      disabled={act.isPending}
                      onPress={() => act.mutate({ id: c._id, body: { action: 'save' } })}
                    />
                    {c.outcome === 'missed' && (
                      <ActionButton
                        label="Save + call-back task"
                        disabled={act.isPending}
                        onPress={() => act.mutate({ id: c._id, body: { action: 'save', createCallbackTask: true } })}
                      />
                    )}
                    <ActionButton label="Existing Lead" disabled={act.isPending} onPress={() => setLinkFor(c._id)} />
                    <ActionButton label="Dismiss" disabled={act.isPending} onPress={() => act.mutate({ id: c._id, body: { action: 'dismiss' } })} />
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      <Modal visible={!!linkFor} transparent animationType="fade" onRequestClose={() => setLinkFor(null)}>
        <View className="flex-1 justify-end bg-black/60">
          <View className="max-h-[75%] rounded-t-3xl border border-surface-border bg-surface-raised px-5 pb-8 pt-5">
            <Text className="font-display-bold text-lg text-white">Link to an existing lead</Text>
            <View className="mt-3">
              <Field value={linkSearch} onChangeText={setLinkSearch} placeholder="Search name or phone" autoCorrect={false} />
            </View>
            <FlatList
              style={{ marginTop: 8 }}
              data={linkOptions}
              keyExtractor={(l) => l._id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: l }) => (
                <Pressable
                  onPress={() => linkFor && act.mutate({ id: linkFor, body: { action: 'link', leadId: l._id } })}
                  style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.border }}
                >
                  <Text className="font-sans-semibold text-sm text-zinc-200">{l.name}</Text>
                  {!!l.phone && <Text className="font-sans text-xs text-zinc-500">{l.phone}</Text>}
                </Pressable>
              )}
              ListEmptyComponent={
                <Text className="py-4 text-center font-sans text-sm text-zinc-500">
                  {leads.isLoading ? 'Loading…' : 'No matching leads.'}
                </Text>
              }
            />
            <Pressable onPress={() => setLinkFor(null)} style={{ marginTop: 8, alignItems: 'center', paddingVertical: 12 }}>
              <Text className="font-sans-semibold text-sm text-zinc-400">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
