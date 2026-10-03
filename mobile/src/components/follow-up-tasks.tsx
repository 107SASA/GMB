import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  createFollowUp,
  fetchFollowUps,
  FOLLOW_UP_TYPES,
  updateFollowUp,
  type FollowUpType,
} from '@/api/endpoints/crm';
import { useDateTimePicker } from '@/components/datetime-picker';
import { Chip, ErrorText, Field, PrimaryButton } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useTheme } from '@/lib/theme';

function tomorrowAt11() {
  const d = new Date(Date.now() + 24 * 3600_000);
  d.setHours(11, 0, 0, 0);
  return d;
}

/**
 * Follow-up TASKS for one lead (reminders for the owner/team). Nothing is
 * sent to the lead — you get a reminder when it's due and contact them yourself.
 */
export function FollowUpTasks({ leadId, businessId }: { leadId: string; businessId: string | null }) {
  const t = useTheme();
  const queryClient = useQueryClient();
  const picker = useDateTimePicker();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<FollowUpType>('Call');
  const [dueAt, setDueAt] = useState<Date>(tomorrowAt11);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const key = ['lead-followups', businessId, leadId];

  const tasks = useQuery({ queryKey: key, queryFn: () => fetchFollowUps(leadId), enabled: !!businessId });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['lead-timeline', businessId, leadId] });
  };

  const create = useMutation({
    mutationFn: () => createFollowUp({ leadId, dueAt, type, note: note.trim() || undefined }),
    onSuccess: () => {
      setAdding(false);
      setNote('');
      setError(null);
      refresh();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Could not save the follow-up.')),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'complete' | 'cancel' }) => updateFollowUp(id, action),
    onSuccess: refresh,
    onError: (err) => setError(getApiErrorMessage(err, 'Could not update the follow-up.')),
  });

  const pending = (tasks.data ?? []).filter((f) => f.status === 'pending');
  const now = Date.now();

  return (
    <View>
      {pending.length === 0 && !adding && (
        <Text className="font-sans text-sm text-zinc-500">No follow-up scheduled.</Text>
      )}
      {pending.map((f) => {
        const overdue = new Date(f.scheduledFor).getTime() < now;
        return (
          <View
            key={f._id}
            className="mb-2 flex-row items-center gap-3 rounded-card border border-surface-border bg-surface-raised px-4 py-3"
          >
            <Ionicons name="alarm-outline" size={18} color={overdue ? '#f87171' : t.brandBright} />
            <View className="flex-1">
              <Text className="font-sans-semibold text-sm text-zinc-200">
                {f.type || 'Task'} · {formatDateTime(f.scheduledFor)}
                {overdue ? '  · Overdue' : ''}
              </Text>
              {!!f.note && <Text className="mt-0.5 font-sans text-xs text-zinc-400">{f.note}</Text>}
            </View>
            <Pressable hitSlop={8} onPress={() => act.mutate({ id: f._id, action: 'complete' })}>
              <Ionicons name="checkmark-circle-outline" size={24} color={t.brandBright} />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => act.mutate({ id: f._id, action: 'cancel' })}>
              <Ionicons name="close-circle-outline" size={24} color={t.textFaint} />
            </Pressable>
          </View>
        );
      })}

      {adding ? (
        <View className="mt-2 gap-3 rounded-card border border-surface-border bg-surface-raised px-4 py-4">
          <View className="flex-row flex-wrap gap-2">
            {FOLLOW_UP_TYPES.map((ft) => (
              <Chip key={ft} label={ft} selected={type === ft} onPress={() => setType(ft)} />
            ))}
          </View>
          <Pressable
            onPress={() => picker.open(dueAt, setDueAt)}
            style={{ borderRadius: 14, borderWidth: 1, borderColor: t.border, paddingHorizontal: 14, paddingVertical: 12 }}
          >
            <Text className="font-sans text-sm text-zinc-200">Due: {formatDateTime(dueAt.toISOString())}</Text>
          </Pressable>
          <Field value={note} onChangeText={setNote} placeholder="e.g. Discuss quotation" maxLength={1000} />
          <Text className="font-sans text-xs text-zinc-500">
            You&apos;ll get a reminder when it&apos;s due. Nothing is sent to the lead.
          </Text>
          <PrimaryButton title="Save follow-up" loading={create.isPending} onPress={() => create.mutate()} />
          <Pressable onPress={() => setAdding(false)} style={{ alignItems: 'center', paddingVertical: 8 }}>
            <Text className="font-sans-semibold text-sm text-zinc-400">Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setAdding(true)} style={{ marginTop: 8, paddingVertical: 8 }}>
          <Text className="font-sans-semibold text-sm text-indigo-300">+ Add follow-up</Text>
        </Pressable>
      )}
      {!!error && <ErrorText>{error}</ErrorText>}
      {picker.element}
    </View>
  );
}
