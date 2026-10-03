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
import { fetchLeadStages, formatMoney, groupLabel, LIFECYCLE_STAGES } from '@/api/endpoints/crm';
import { fetchThreads } from '@/api/endpoints/inbox';
import {
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
import { DealValueSheet } from '@/components/deal-value-sheet';
import { FollowUpTasks } from '@/components/follow-up-tasks';
import {
  BackChevron,
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
import { useTheme } from '@/lib/theme';

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-2 mt-6 font-sans-bold text-xs uppercase tracking-wider text-zinc-500">
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
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      // No `className` — react-native-css-interop can swallow onPress on
      // styled Pressables (see components/ui.tsx).
      style={{
        flex: 1,
        alignItems: 'center',
        gap: 4,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.card,
        paddingVertical: 12,
      }}
    >
      <Ionicons name={icon} size={20} color={t.brandBright} />
      <Text className="font-sans-semibold text-xs text-zinc-300">{label}</Text>
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
    case 'follow_up':
      return 'alarm-outline';
    case 'appointment':
      return 'calendar-outline';
    case 'deal_won':
      return 'trophy-outline';
    case 'deal_lost':
      return 'close-circle-outline';
    case 'lead_created':
      return 'person-add-outline';
    default:
      return 'document-text-outline';
  }
}

const TIMELINE_LABEL: Record<string, string> = {
  status_change: 'Stage change',
  lead_created: 'Lead created',
  follow_up: 'Follow-up',
  appointment: 'Appointment',
  deal_won: 'Won',
  deal_lost: 'Lost',
};

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const label =
    entry.timelineType === 'followUp'
      ? `Follow-up${entry.status ? ` · ${entry.status}` : ''}`
      : (TIMELINE_LABEL[entry.type ?? ''] ?? entry.type ?? 'Activity');
  const body = entry.timelineType === 'followUp' ? entry.messageTemplate : entry.content;

  const t = useTheme();
  return (
    <View className="flex-row gap-3 border-b border-surface-border px-4 py-3">
      <View className="mt-0.5 h-7 w-7 items-center justify-center rounded-full bg-zinc-800">
        <Ionicons name={timelineIcon(entry)} size={14} color={t.textFaint} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="font-sans-semibold text-sm text-zinc-200">{label}</Text>
          <Text className="font-sans text-xs text-zinc-500">{formatDateTime(entry.date)}</Text>
        </View>
        {!!body && <Text className="mt-0.5 font-sans text-sm text-zinc-400">{body}</Text>}
      </View>
    </View>
  );
}

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const t = useTheme();

  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Won needs the deal value: 'win' = moving to converted, 'edit' = record/edit it.
  const [dealMode, setDealMode] = useState<null | 'win' | 'edit'>(null);

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

  const stagesQuery = useQuery({
    queryKey: ['lead-stages', activeBusinessId],
    queryFn: fetchLeadStages,
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
      // The deal itself is shaped server-side; optimistic update covers the stage only.
      const { deal: _deal, ...optimistic } = changes;
      queryClient.setQueryData<Lead[]>(['crm-leads', activeBusinessId], (old) =>
        old?.map((l) => (l._id === id ? { ...l, ...optimistic } : l))
      );
      return { previous };
    },
    onSuccess: (_data, changes) => {
      if (changes.deal) setDealMode(null);
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

  const stageConfig = stagesQuery.data;
  const currentGroup = lead.lifeCycleStage || 'initial';
  const subOptions =
    stageConfig && currentGroup !== 'initial'
      ? stageConfig[currentGroup as 'active' | 'converted' | 'closed'] ?? []
      : [];
  const currentSubId =
    subOptions.find((s) => (lead.subStageId ? s.id === lead.subStageId : s.name === lead.subStage))?.id ?? null;
  const hasDealValue = typeof lead.deal?.value === 'number';

  function moveToGroup(group: string) {
    if (group === currentGroup || patch.isPending) return;
    if (group === 'converted' && !hasDealValue) {
      setDealMode('win');
      return;
    }
    patch.mutate({ lifeCycleStage: group, subStageId: null, subStage: null });
  }
  const notes = notesDraft ?? lead.notes ?? '';
  const notesDirty = notesDraft !== null && notesDraft !== (lead.notes ?? '');

  return (
    <Screen>
      {/* Header */}
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <BackChevron />
        </Pressable>
        <View className="flex-1">
          <Text className="font-display-bold text-lg text-white" numberOfLines={1}>
            {lead.name}
          </Text>
          <Text className="font-sans text-xs text-zinc-500">
            {lead.source}
            {lead.phone ? ` · ${lead.phone}` : ''}
          </Text>
        </View>
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
            tintColor={t.brandBright}
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

        {/* Stage — the same lifeCycleStage + sub-stage model as the web CRM */}
        <SectionLabel>Stage</SectionLabel>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2"
        >
          {LIFECYCLE_STAGES.map((group) => (
            <Chip
              key={group}
              label={groupLabel(stageConfig, group)}
              selected={currentGroup === group}
              onPress={() => moveToGroup(group)}
            />
          ))}
        </ScrollView>
        {subOptions.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2 pt-2"
          >
            {subOptions.map((sub) => (
              <Chip
                key={sub.id ?? sub.name}
                label={sub.name}
                selected={currentSubId === sub.id}
                onPress={() => {
                  if (patch.isPending || currentSubId === sub.id) return;
                  patch.mutate({ lifeCycleStage: currentGroup, subStageId: sub.id ?? null, subStage: sub.name });
                }}
              />
            ))}
          </ScrollView>
        )}

        {/* Deal value (Won leads) */}
        {currentGroup === 'converted' && (
          <View className="mt-3 flex-row items-center justify-between rounded-card border border-surface-border bg-surface-raised px-4 py-3.5">
            <View className="flex-1">
              <Text className="font-sans-bold text-xs uppercase tracking-wider text-zinc-500">Deal value</Text>
              <Text className="mt-1 font-display-bold text-lg text-white">
                {hasDealValue ? formatMoney(lead.deal!.value, lead.deal!.currency) : 'Not recorded'}
              </Text>
              {!hasDealValue && (
                <Text className="font-sans text-xs text-zinc-500">Not counted in revenue until you add it.</Text>
              )}
            </View>
            <Pressable onPress={() => setDealMode('edit')} hitSlop={8}>
              <Text className="font-sans-semibold text-sm text-indigo-300">{hasDealValue ? 'Edit' : 'Add value'}</Text>
            </Pressable>
          </View>
        )}

        <DealValueSheet
          visible={dealMode !== null}
          leadName={lead.name}
          initial={lead.deal ? { value: lead.deal.value, currency: lead.deal.currency } : null}
          saving={patch.isPending}
          error={dealMode ? error : null}
          onCancel={() => setDealMode(null)}
          onConfirm={(deal) => {
            if (dealMode === 'win') {
              const first = stageConfig?.converted?.[0];
              patch.mutate({ lifeCycleStage: 'converted', subStageId: first?.id ?? null, subStage: first?.name ?? null, deal });
            } else {
              patch.mutate({ deal });
            }
          }}
        />

        {/* Follow-up tasks (reminders for you — never sent to the lead) */}
        <SectionLabel>Follow-ups</SectionLabel>
        <FollowUpTasks leadId={lead._id} businessId={activeBusinessId} />

        {/* Details */}
        {!!lead.interest && (
          <>
            <SectionLabel>Details</SectionLabel>
            <View className="gap-2 rounded-card border border-surface-border bg-surface-raised px-4 py-3.5">
              <Text className="font-sans text-sm text-zinc-300">
                <Text className="font-sans-semibold text-zinc-400">Interest: </Text>
                {lead.interest}
              </Text>
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
              <Text className="font-display-bold text-lg text-white">How did the call go?</Text>
              <Text className="mt-1 font-sans text-sm text-zinc-400">
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
                // No `className` — see components/ui.tsx PrimaryButton note.
                style={{ marginTop: 8, alignItems: 'center', paddingVertical: 12 }}
              >
                <Text className="font-sans-semibold text-sm text-zinc-400">
                  Don't log this call
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
        {consentSheet}

        {/* Timeline */}
        <SectionLabel>Activity timeline</SectionLabel>
        {timeline.isLoading ? (
          <Skeleton className="h-32 rounded-card" />
        ) : timeline.isError ? (
          <Text className="font-sans text-sm text-zinc-500">
            {getApiErrorMessage(timeline.error, 'Could not load the timeline.')}
          </Text>
        ) : (timeline.data ?? []).length === 0 ? (
          <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-6">
            <Text className="text-center font-sans text-sm text-zinc-400">No activity yet.</Text>
          </View>
        ) : (
          <View className="overflow-hidden rounded-card border border-surface-border bg-surface-raised">
            {timeline.data!.map((entry) => (
              <TimelineRow key={`${entry.timelineType}-${entry._id}`} entry={entry} />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
