import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  APPOINTMENT_STATUSES,
  cancelAppointment,
  fetchAppointments,
  fetchBusinessHours,
  fetchInboxConfig,
  saveBusinessHours,
  saveInboxConfig,
  WEEKDAYS,
  type Appointment,
  type AppointmentStatus,
  type BusinessHours,
  type InboxConfig,
} from '@/api/endpoints/whatsapp';
import { useBusiness } from '@/business/BusinessContext';
import {
  Badge,
  Chip,
  EmptyState,
  Field,
  LabeledField,
  PrimaryButton,
  Screen,
  ScreenTitle,
  SectionLabel,
  SegmentedControl,
  Skeleton,
} from '@/components/ui';
import { useTheme } from '@/lib/theme';

const PERSONALITIES = ['friendly', 'professional', 'enthusiastic', 'calm'];
const TONES = ['professional', 'casual', 'formal', 'playful'];

function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View className="flex-row items-center justify-between rounded-xl border border-surface-border bg-surface-raised px-4 py-3">
      <Text className="flex-1 text-sm text-white">{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: t.border, true: t.brand }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

// --- AI settings -----------------------------------------------------------------

function AiSettingsForm({ initial }: { initial: InboxConfig }) {
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const [config, setConfig] = useState(initial);

  const save = useMutation({
    mutationFn: () => saveInboxConfig(config),
    onSuccess: () => {
      Alert.alert('Saved', 'AI agent settings updated.');
      void queryClient.invalidateQueries({ queryKey: ['inbox-config', activeBusinessId] });
    },
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not save settings.')),
  });

  return (
    <ScrollView contentContainerClassName="px-5 pb-12" keyboardShouldPersistTaps="handled">
      <View className="mb-3">
        <SwitchRow
          label="AI agent enabled"
          value={config.aiEnabled}
          onValueChange={(aiEnabled) => setConfig({ ...config, aiEnabled })}
        />
      </View>

      <Text className="mb-1.5 px-1 text-xs font-medium text-zinc-400">Personality</Text>
      <View className="mb-3 flex-row flex-wrap gap-2">
        {PERSONALITIES.map((p) => (
          <Chip
            key={p}
            label={p}
            selected={config.aiPersonality === p}
            onPress={() => setConfig({ ...config, aiPersonality: p })}
          />
        ))}
      </View>

      <Text className="mb-1.5 px-1 text-xs font-medium text-zinc-400">Tone</Text>
      <View className="mb-3 flex-row flex-wrap gap-2">
        {TONES.map((t) => (
          <Chip
            key={t}
            label={t}
            selected={config.tone === t}
            onPress={() => setConfig({ ...config, tone: t })}
          />
        ))}
      </View>

      <LabeledField
        label="Max response length (characters)"
        value={String(config.maxResponseLength)}
        onChangeText={(v) =>
          setConfig({ ...config, maxResponseLength: Number(v.replace(/[^\d]/g, '')) || 0 })
        }
        keyboardType="number-pad"
      />

      <Text className="mb-1.5 px-1 text-xs font-medium text-zinc-400">System prompt</Text>
      <Field
        value={config.systemPrompt}
        onChangeText={(systemPrompt) => setConfig({ ...config, systemPrompt })}
        multiline
        textAlignVertical="top"
        className="min-h-[120px] mb-3"
        placeholder="How should the AI introduce itself and behave?"
      />

      <Text className="mb-1.5 px-1 text-xs font-medium text-zinc-400">Sales rules</Text>
      <Field
        value={config.salesRules}
        onChangeText={(salesRules) => setConfig({ ...config, salesRules })}
        multiline
        textAlignVertical="top"
        className="min-h-[100px] mb-4"
        placeholder="Pricing rules, offers, what never to promise…"
      />

      <PrimaryButton title="Save settings" onPress={() => save.mutate()} loading={save.isPending} />
    </ScrollView>
  );
}

function AiSettingsSegment() {
  const { activeBusinessId } = useBusiness();
  const config = useQuery({
    queryKey: ['inbox-config', activeBusinessId],
    queryFn: fetchInboxConfig,
    enabled: !!activeBusinessId,
  });

  if (config.isLoading)
    return (
      <View className="gap-3 px-5">
        <Skeleton className="h-14" />
        <Skeleton className="h-32" />
      </View>
    );
  if (config.isError || !config.data)
    return (
      <EmptyState
        title="Couldn't load AI settings"
        hint={getApiErrorMessage(config.error, 'Try again.')}
      />
    );
  return <AiSettingsForm key={config.dataUpdatedAt} initial={config.data} />;
}

// --- Booking settings ---------------------------------------------------------------

function BookingForm({ initial }: { initial: BusinessHours }) {
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const [settings, setSettings] = useState(initial);

  const save = useMutation({
    mutationFn: () => saveBusinessHours(settings),
    onSuccess: () => {
      Alert.alert('Saved', 'Booking settings updated.');
      void queryClient.invalidateQueries({ queryKey: ['business-hours', activeBusinessId] });
    },
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not save settings.')),
  });

  return (
    <ScrollView contentContainerClassName="px-5 pb-12" keyboardShouldPersistTaps="handled">
      <View className="mb-3">
        <SwitchRow
          label="Let the AI book appointments"
          value={settings.bookingEnabled}
          onValueChange={(bookingEnabled) => setSettings({ ...settings, bookingEnabled })}
        />
      </View>

      <Text className="mb-1.5 px-1 text-xs font-medium text-zinc-400">Working days</Text>
      <View className="mb-3 gap-2">
        {WEEKDAYS.map((day) => (
          <SwitchRow
            key={day}
            label={day.charAt(0).toUpperCase() + day.slice(1)}
            value={settings.workingDays[day]}
            onValueChange={(on) =>
              setSettings({
                ...settings,
                workingDays: { ...settings.workingDays, [day]: on },
              })
            }
          />
        ))}
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1">
          <LabeledField
            label="Opens (HH:mm)"
            value={settings.openingTime}
            onChangeText={(openingTime) => setSettings({ ...settings, openingTime })}
            placeholder="09:00"
            autoCapitalize="none"
          />
        </View>
        <View className="flex-1">
          <LabeledField
            label="Closes (HH:mm)"
            value={settings.closingTime}
            onChangeText={(closingTime) => setSettings({ ...settings, closingTime })}
            placeholder="18:00"
            autoCapitalize="none"
          />
        </View>
      </View>

      <LabeledField
        label="Slot duration (minutes)"
        value={String(settings.slotDurationMinutes)}
        onChangeText={(v) =>
          setSettings({ ...settings, slotDurationMinutes: Number(v.replace(/[^\d]/g, '')) || 0 })
        }
        keyboardType="number-pad"
      />

      <PrimaryButton title="Save booking settings" onPress={() => save.mutate()} loading={save.isPending} />
    </ScrollView>
  );
}

function BookingSegment() {
  const { activeBusinessId } = useBusiness();
  const hours = useQuery({
    queryKey: ['business-hours', activeBusinessId],
    queryFn: fetchBusinessHours,
    enabled: !!activeBusinessId,
  });

  if (hours.isLoading)
    return (
      <View className="gap-3 px-5">
        <Skeleton className="h-14" />
        <Skeleton className="h-64" />
      </View>
    );
  if (hours.isError || !hours.data)
    return (
      <EmptyState
        title="Couldn't load booking settings"
        hint={getApiErrorMessage(hours.error, 'Try again.')}
      />
    );
  return <BookingForm key={hours.dataUpdatedAt} initial={hours.data} />;
}

// --- Appointments -----------------------------------------------------------------

const STATUS_TONES: Record<AppointmentStatus, 'warning' | 'positive' | 'negative' | 'info'> = {
  Pending: 'warning',
  Confirmed: 'positive',
  Cancelled: 'negative',
  Completed: 'info',
};

function CancelModal({
  appointment,
  onClose,
  onCancelled,
}: {
  appointment: Appointment;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => cancelAppointment(appointment._id, reason.trim() || 'Cancelled by business'),
    onSuccess: () => {
      onCancelled();
      onClose();
    },
    onError: (err) =>
      Alert.alert('Error', getApiErrorMessage(err, 'Could not cancel the appointment.')),
  });

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <View className="w-full rounded-2xl border border-surface-border bg-surface px-5 py-5">
          <Text className="text-lg font-bold text-white">Cancel appointment</Text>
          <Text className="mt-1 text-sm text-zinc-400">
            {appointment.customerName} · {appointment.date} {appointment.time}
          </Text>
          <View className="mt-3">
            <Field value={reason} onChangeText={setReason} placeholder="Reason (optional)" />
          </View>
          <View className="mt-4 flex-row gap-3">
            <Pressable
              onPress={onClose}
              className="flex-1 items-center rounded-xl border border-surface-border py-3 active:opacity-70"
            >
              <Text className="text-sm font-medium text-zinc-300">Keep it</Text>
            </Pressable>
            <Pressable
              onPress={() => cancel.mutate()}
              disabled={cancel.isPending}
              className="flex-1 items-center rounded-xl bg-rose-400/15 py-3 active:opacity-80"
            >
              <Text className="text-sm font-semibold text-rose-300">
                {cancel.isPending ? 'Cancelling…' : 'Cancel it'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AppointmentsSegment() {
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AppointmentStatus | 'All'>('All');
  const [cancelling, setCancelling] = useState<Appointment | null>(null);

  const appointments = useQuery({
    queryKey: ['appointments', activeBusinessId, status],
    queryFn: () => fetchAppointments(status === 'All' ? undefined : status),
    enabled: !!activeBusinessId,
    refetchInterval: 20_000,
  });

  return (
    <>
      <View className="pb-3">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-5">
          {(['All', ...APPOINTMENT_STATUSES] as const).map((s) => (
            <Chip key={s} label={s} selected={status === s} onPress={() => setStatus(s)} />
          ))}
        </ScrollView>
      </View>

      {appointments.isLoading ? (
        <View className="gap-3 px-5">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </View>
      ) : appointments.isError ? (
        <EmptyState
          title="Couldn't load appointments"
          hint={getApiErrorMessage(appointments.error, 'Pull down to retry.')}
        />
      ) : (
        <FlatList
          data={appointments.data}
          keyExtractor={(a) => a._id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={appointments.isRefetching}
              onRefresh={() => void appointments.refetch()}
              tintColor="#6366F1"
            />
          }
          renderItem={({ item }) => (
            <View className="mb-3 rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-base font-semibold text-white" numberOfLines={1}>
                  {item.customerName}
                </Text>
                <Badge label={item.status} tone={STATUS_TONES[item.status]} />
              </View>
              <Text className="mt-1 text-sm text-zinc-400">
                {item.date} at {item.time}
                {item.serviceRequested ? ` · ${item.serviceRequested}` : ''}
              </Text>
              {!!item.phone && <Text className="mt-0.5 text-xs text-zinc-500">{item.phone}</Text>}
              {item.status === 'Cancelled' && !!item.cancelReason && (
                <Text className="mt-1 text-xs text-zinc-500">Reason: {item.cancelReason}</Text>
              )}
              {(item.status === 'Pending' || item.status === 'Confirmed') && (
                <Pressable
                  onPress={() => setCancelling(item)}
                  className="mt-3 self-start rounded-full border border-rose-400/25 px-3 py-1.5 active:opacity-70"
                >
                  <Text className="text-xs font-medium text-rose-300">Cancel appointment</Text>
                </Pressable>
              )}
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              title="No appointments"
              hint="Bookings made through the WhatsApp AI agent will appear here."
            />
          }
        />
      )}

      {cancelling && (
        <CancelModal
          appointment={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() =>
            void queryClient.invalidateQueries({ queryKey: ['appointments', activeBusinessId] })
          }
        />
      )}
    </>
  );
}

// --- Screen ---------------------------------------------------------------------------

export default function WhatsappScreen() {
  const router = useRouter();
  const [segment, setSegment] = useState<'ai' | 'booking' | 'appointments'>('ai');

  return (
    <Screen>
      <ScreenTitle>WhatsApp AI Agent</ScreenTitle>

      <Pressable
        onPress={() => router.push('/inbox')}
        className="mx-5 mb-3 flex-row items-center gap-2 rounded-xl border border-surface-border bg-surface-raised px-3.5 py-2.5 active:opacity-70"
      >
        <Ionicons name="chatbubbles-outline" size={16} color="#6366F1" />
        <Text className="flex-1 text-xs text-zinc-300">
          Customer conversations live in the Inbox tab.
        </Text>
        <Ionicons name="chevron-forward" size={14} color="#4A5175" />
      </Pressable>

      <SegmentedControl
        segments={[
          { id: 'ai', label: 'AI Settings' },
          { id: 'booking', label: 'Booking' },
          { id: 'appointments', label: 'Appointments' },
        ]}
        value={segment}
        onChange={setSegment}
      />

      {segment === 'ai' && <AiSettingsSegment />}
      {segment === 'booking' && <BookingSegment />}
      {segment === 'appointments' && <AppointmentsSegment />}
    </Screen>
  );
}
