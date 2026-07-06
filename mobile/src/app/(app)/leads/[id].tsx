import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchThreads } from '@/api/endpoints/inbox';
import {
  fetchKanbanColumns,
  fetchLeads,
  fetchLeadTimeline,
  logLeadActivity,
  updateLead,
  type Lead,
  type LeadPatch,
  type TimelineEntry,
} from '@/api/endpoints/leads';
import { useBusiness } from '@/business/BusinessContext';
import { useCrmCaptureConsent } from '@/components/consent-sheet';
import {
  BackChevron,
  Badge,
  Chip,
  EmptyState,
  ErrorText,
  Field,
  LoadingScreen,
  PrimaryButton,
  Screen,
  Skeleton,
} from '@/components/ui';
import { formatDateTime, whatsappNumber } from '@/lib/format';

const UNASSIGNED = 'Unassigned';

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </Text>
  );
}

function ContactAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center gap-1 rounded-xl border border-surface-border bg-surface-raised py-3 active:opacity-70"
    >
      <Ionicons name={icon} size={20} color="#6366F1" />
      <Text className="text-xs font-medium text-zinc-300">{label}</Text>
    </Pressable>
  );
}

function timelineIcon(entry: TimelineEntry): keyof typeof Ionicons.glyphMap {
  if (entry.timelineType === 'followUp') return 'alarm-outline';
  switch (entry.type) {
    case 'call':
      return 'call-outline';
    case 'WhatsApp':
      return 'logo-whatsapp';
    case 'email':
      return 'mail-outline';
    case 'meeting':
      return 'calendar-outline';
    case 'status_change':
      return 'swap-horizontal-outline';
    default:
      return 'document-text-outline';
  }
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const label =
    entry.timelineType === 'followUp'
      ? `Follow-up${entry.status ? ` · ${entry.status}` : ''}`
      : entry.type === 'status_change'
        ? 'Stage change'
        : entry.type || 'Activity';
  const body = entry.timelineType === 'followUp' ? entry.messageTemplate : entry.content;

  return (
    <View className="flex-row gap-3 border-b border-surface-border px-4 py-3">
      <View className="mt-0.5 h-7 w-7 items-center justify-center rounded-full bg-zinc-800">
        <Ionicons name={timelineIcon(entry)} size={14} color="#8B93B8" />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-semibold text-zinc-200">{label}</Text>
          <Text className="text-xs text-zinc-500">{formatDateTime(entry.date)}</Text>
        </View>
        {!!body && <Text className="mt-0.5 text-sm text-zinc-400">{body}</Text>}
      </View>
    </View>
  );
}

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();

  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Plan-A call logging: when a call was started from here, coming back to
  // the foreground opens a "How did the call go?" prompt.
  const { ensureConsent, consentSheet } = useCrmCaptureConsent();
  const callInFlight = useRef(false);
  const [callPromptVisible, setCallPromptVisible] = useState(false);
  const [callNote, setCallNote] = useState('');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && callInFlight.current) {
        callInFlight.current = false;
        setCallPromptVisible(true);
      }
    });
    return () => sub.remove();
  }, []);

  const leads = useQuery({
    queryKey: ['crm-leads', activeBusinessId],
    queryFn: fetchLeads,
    enabled: !!activeBusinessId,
  });
  const lead = useMemo(() => leads.data?.find((l) => l._id === id) ?? null, [leads.data, id]);

  const columns = useQuery({
    queryKey: ['kanban-columns', activeBusinessId],
    queryFn: fetchKanbanColumns,
    enabled: !!activeBusinessId,
  });
  const timeline = useQuery({
    queryKey: ['lead-timeline', activeBusinessId, id],
    queryFn: () => fetchLeadTimeline(id),
    enabled: !!activeBusinessId && !!id,
  });
  // Used for the "Open conversation" shortcut — only shown when a thread exists.
  const threads = useQuery({
    queryKey: ['inbox-threads', activeBusinessId],
    queryFn: fetchThreads,
    enabled: !!activeBusinessId,
  });
  const hasThread = threads.data?.some((t) => t.leadId?._id === id) ?? false;

  const patch = useMutation({
    mutationFn: (changes: LeadPatch) => updateLead(id, changes),
    onMutate: async (changes) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: ['crm-leads', activeBusinessId] });
      const previous = queryClient.getQueryData<Lead[]>(['crm-leads', activeBusinessId]);
      queryClient.setQueryData<Lead[]>(['crm-leads', activeBusinessId], (old) =>
        old?.map((l) => (l._id === id ? { ...l, ...changes } : l))
      );
      return { previous };
    },
    onError: (err, _changes, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['crm-leads', activeBusinessId], context.previous);
      }
      setError(getApiErrorMessage(err, 'Failed to update lead.'));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['crm-leads', activeBusinessId] });
      // Stage changes write an Activity server-side.
      void queryClient.invalidateQueries({ queryKey: ['lead-timeline', activeBusinessId, id] });
    },
  });

  const logCall = useMutation({
    mutationFn: (note: string) =>
      logLeadActivity(id, { type: 'call', content: note || 'Phone call logged from mobile' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lead-timeline', activeBusinessId, id] });
      void queryClient.invalidateQueries({ queryKey: ['crm-leads', activeBusinessId] });
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Failed to log the call.')),
    onSettled: () => {
      setCallPromptVisible(false);
      setCallNote('');
    },
  });

  async function saveCallLog() {
    // Close the prompt before the consent sheet — two stacked sibling
    // Modals don't layer reliably on iOS.
    const note = callNote.trim();
    setCallPromptVisible(false);
    if (!(await ensureConsent())) {
      setCallNote('');
      return;
    }
    logCall.mutate(note);
  }

  if (leads.isLoading) return <LoadingScreen />;

  if (!lead) {
    return (
      <Screen>
        <EmptyState
          title="Lead not found"
          hint={getApiErrorMessage(leads.error, 'It may have been deleted.')}
        />
      </Screen>
    );
  }

  const stages = [...(columns.data ?? []), UNASSIGNED];
  const currentStage = lead.pipelineStage || UNASSIGNED;
  const notes = notesDraft ?? lead.notes ?? '';
  const notesDirty = notesDraft !== null && notesDraft !== (lead.notes ?? '');

  return (
    <Screen>
      {/* Header */}
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
        <Pressable onPress={() => router.back()} hitSlop={8} className="active:opacity-60">
          <BackChevron />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-bold text-white" numberOfLines={1}>
            {lead.name}
          </Text>
          <Text className="text-xs text-zinc-500">
            {lead.source}
            {lead.phone ? ` · ${lead.phone}` : ''}
          </Text>
        </View>
        {lead.aiLeadScore != null && <Badge label={`Score ${lead.aiLeadScore}`} tone="info" />}
      </View>

      <ScrollView
        contentContainerClassName="px-5 pb-10"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={leads.isRefetching || timeline.isRefetching}
            onRefresh={() => {
              void leads.refetch();
              void timeline.refetch();
            }}
            tintColor="#6366F1"
          />
        }
      >
        {/* Contact actions */}
        <View className="mt-4 flex-row gap-3">
          {!!lead.phone && (
            <ContactAction
              icon="call-outline"
              label="Call"
              onPress={() => {
                callInFlight.current = true;
                void Linking.openURL(`tel:${lead.phone}`);
              }}
            />
          )}
          {!!lead.phone && (
            <ContactAction
              icon="logo-whatsapp"
              label="WhatsApp"
              onPress={() => void Linking.openURL(`https://wa.me/${whatsappNumber(lead.phone!)}`)}
            />
          )}
          {!!lead.email && (
            <ContactAction
              icon="mail-outline"
              label="Email"
              onPress={() => void Linking.openURL(`mailto:${lead.email}`)}
            />
          )}
          {hasThread && (
            <ContactAction
              icon="chatbubbles-outline"
              label="Inbox"
              onPress={() => router.push(`/inbox/${lead._id}`)}
            />
          )}
        </View>

        {!!error && (
          <View className="pt-3">
            <ErrorText>{error}</ErrorText>
          </View>
        )}

        {/* Pipeline stage */}
        <SectionLabel>Pipeline stage</SectionLabel>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2"
        >
          {stages.map((stage) => (
            <Chip
              key={stage}
              label={stage}
              selected={currentStage === stage}
              onPress={() => {
                if (stage === currentStage || patch.isPending) return;
                patch.mutate({ pipelineStage: stage === UNASSIGNED ? null : stage });
              }}
            />
          ))}
        </ScrollView>

        {/* Details */}
        {(lead.interest || lead.aiInsights) && (
          <>
            <SectionLabel>Details</SectionLabel>
            <View className="gap-2 rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5">
              {!!lead.interest && (
                <Text className="text-sm text-zinc-300">
                  <Text className="font-semibold text-zinc-400">Interest: </Text>
                  {lead.interest}
                </Text>
              )}
              {!!lead.aiInsights && (
                <Text className="text-sm text-zinc-300">
                  <Text className="font-semibold text-zinc-400">AI insights: </Text>
                  {lead.aiInsights}
                </Text>
              )}
            </View>
          </>
        )}

        {/* Notes */}
        <SectionLabel>Notes</SectionLabel>
        <Field
          value={notes}
          onChangeText={setNotesDraft}
          placeholder="Add notes about this lead…"
          multiline
          className="min-h-24"
          textAlignVertical="top"
        />
        {notesDirty && (
          <View className="mt-3">
            <PrimaryButton
              title="Save notes"
              loading={patch.isPending}
              onPress={() => patch.mutate({ notes })}
            />
          </View>
        )}

        {/* Post-call prompt (Plan-A call logging) */}
        <Modal
          visible={callPromptVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setCallPromptVisible(false)}
        >
          <View className="flex-1 justify-end bg-black/60">
            <View className="rounded-t-3xl border border-surface-border bg-surface-raised px-6 pb-10 pt-6">
              <Text className="text-lg font-bold text-white">How did the call go?</Text>
              <Text className="mt-1 text-sm text-zinc-400">
                A call activity will be added to {lead.name}'s timeline.
              </Text>
              <View className="mt-4">
                <Field
                  value={callNote}
                  onChangeText={setCallNote}
                  placeholder="Add a note (optional)"
                  multiline
                  className="min-h-20"
                  textAlignVertical="top"
                />
              </View>
              <View className="mt-4">
                <PrimaryButton
                  title="Log call"
                  loading={logCall.isPending}
                  onPress={() => void saveCallLog()}
                />
              </View>
              <Pressable
                onPress={() => {
                  setCallPromptVisible(false);
                  setCallNote('');
                }}
                className="mt-2 items-center py-3 active:opacity-60"
              >
                <Text className="text-sm font-medium text-zinc-400">Don't log this call</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
        {consentSheet}

        {/* Timeline */}
        <SectionLabel>Activity timeline</SectionLabel>
        {timeline.isLoading ? (
          <Skeleton className="h-32" />
        ) : timeline.isError ? (
          <Text className="text-sm text-zinc-500">
            {getApiErrorMessage(timeline.error, 'Could not load the timeline.')}
          </Text>
        ) : (timeline.data ?? []).length === 0 ? (
          <View className="rounded-xl border border-surface-border bg-surface-raised px-4 py-6">
            <Text className="text-center text-sm text-zinc-400">No activity yet.</Text>
          </View>
        ) : (
          <View className="overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
            {timeline.data!.map((entry) => (
              <TimelineRow key={`${entry.timelineType}-${entry._id}`} entry={entry} />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
