import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  fetchBusinessDetail,
  fetchNotificationPrefs,
  NOTIFICATION_PREFS,
  updateBusinessDetail,
  updateNotificationPrefs,
  type BusinessDetail,
  type NotificationPrefs,
} from '@/api/endpoints/account';
import { disconnectGoogle } from '@/api/endpoints/gbp';
import { useBusiness } from '@/business/BusinessContext';
import {
  Chip,
  EmptyState,
  Field,
  LabeledField,
  PrimaryButton,
  Screen,
  ScreenTitle,
  SectionLabel,
  Skeleton,
  useConfirmSheet,
  useInfoSheet,
} from '@/components/ui';
import { promptConnectGoogle } from '@/lib/connectGoogle';
import { useTheme } from '@/lib/theme';

// --- Business profile form ------------------------------------------------------

function BusinessForm({ initial }: { initial: BusinessDetail }) {
  const t = useTheme();
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();

  const [form, setForm] = useState({
    name: initial.name,
    category: initial.category ?? '',
    description: initial.description ?? '',
    phone: initial.phone ?? '',
    website: initial.website ?? '',
    address: initial.address ?? '',
    whatsappNumber: initial.integrations?.whatsappNumber ?? '',
  });
  const [keywords, setKeywords] = useState<string[]>(initial.keywords);
  const [keywordInput, setKeywordInput] = useState('');
  const info = useInfoSheet();

  const save = useMutation({
    mutationFn: () =>
      updateBusinessDetail(initial._id, {
        name: form.name,
        category: form.category,
        description: form.description,
        phone: form.phone,
        website: form.website,
        address: form.address,
        keywords,
        'integrations.whatsappNumber': form.whatsappNumber,
      }),
    onSuccess: () => {
      info.show('Saved', 'Business profile updated.');
      void queryClient.invalidateQueries({ queryKey: ['business-detail', activeBusinessId] });
      // The switcher list shows name/category — keep it in sync.
      void queryClient.invalidateQueries({ queryKey: ['businesses'] });
    },
    onError: (err) => info.show('Error', getApiErrorMessage(err, 'Could not save the profile.')),
  });

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  function addKeyword() {
    const value = keywordInput.trim();
    if (!value || keywords.includes(value)) return;
    if (keywords.length >= 20) {
      info.show('Limit reached', 'You can save up to 20 keywords.');
      return;
    }
    setKeywords([...keywords, value]);
    setKeywordInput('');
  }

  return (
    <View>
      <LabeledField label="Business name" value={form.name} onChangeText={set('name')} />
      <LabeledField label="Category" value={form.category} onChangeText={set('category')} />
      <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">Description</Text>
      <Field
        value={form.description}
        onChangeText={set('description')}
        multiline
        textAlignVertical="top"
        className="min-h-[90px] mb-3"
      />
      <LabeledField label="Phone" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
      <LabeledField
        label="Website"
        value={form.website}
        onChangeText={set('website')}
        autoCapitalize="none"
        keyboardType="url"
      />
      <LabeledField label="Address" value={form.address} onChangeText={set('address')} />
      <LabeledField
        label="WhatsApp number"
        value={form.whatsappNumber}
        onChangeText={set('whatsappNumber')}
        keyboardType="phone-pad"
        placeholder="+91…"
      />

      <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">Keywords (max 20)</Text>
      <View className="mb-2 flex-row gap-2">
        <View className="flex-1">
          <Field
            value={keywordInput}
            onChangeText={setKeywordInput}
            placeholder="Add a keyword"
            onSubmitEditing={addKeyword}
            returnKeyType="done"
          />
        </View>
        <Pressable
          onPress={addKeyword}
          // No `className` — react-native-css-interop can swallow onPress on
          // styled Pressables (see components/ui.tsx).
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.card,
            paddingHorizontal: 16,
          }}
        >
          <Ionicons name="add" size={20} color={t.text} />
        </Pressable>
      </View>
      {keywords.length > 0 && (
        <View className="mb-3 flex-row flex-wrap gap-2">
          {keywords.map((k) => (
            <Chip
              key={k}
              label={`${k} ×`}
              selected
              onPress={() => setKeywords(keywords.filter((x) => x !== k))}
            />
          ))}
        </View>
      )}

      <PrimaryButton
        title="Save business profile"
        onPress={() => save.mutate()}
        loading={save.isPending}
        disabled={!form.name.trim()}
      />
      {info.node}
    </View>
  );
}

// --- Notifications ---------------------------------------------------------------

function NotificationsSection({ initial }: { initial: NotificationPrefs }) {
  const t = useTheme();
  const [prefs, setPrefs] = useState(initial);
  const info = useInfoSheet();

  const save = useMutation({
    mutationFn: ({ next }: { next: NotificationPrefs; key: keyof NotificationPrefs }) =>
      updateNotificationPrefs(next),
    onError: (err, { key, next }) => {
      // Auto-save per toggle: roll just this switch back on failure.
      setPrefs((current) => ({ ...current, [key]: !next[key] }));
      info.show('Error', getApiErrorMessage(err, 'Could not update preferences.'));
    },
  });

  function toggle(key: keyof NotificationPrefs, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    save.mutate({ next, key });
  }

  return (
    <View className="overflow-hidden rounded-card border border-surface-border bg-surface-raised">
      {NOTIFICATION_PREFS.map(({ key, label }, i) => (
        <View
          key={key}
          className={`flex-row items-center justify-between px-4 py-3 ${
            i > 0 ? 'border-t border-surface-border' : ''
          }`}
        >
          <Text className="flex-1 font-sans text-sm text-white">{label}</Text>
          <Switch
            value={prefs[key]}
            onValueChange={(v) => toggle(key, v)}
            trackColor={{ false: t.border, true: t.brand }}
            thumbColor="#ffffff"
          />
        </View>
      ))}
      {info.node}
    </View>
  );
}

/**
 * Google's row is interactive (unlike the other read-only integration rows):
 * tapping it connects when not linked, or confirms + disconnects when linked.
 */
function GoogleConnectionRow({ connected }: { connected: boolean }) {
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const info = useInfoSheet();
  const confirmSheet = useConfirmSheet();

  const disconnect = useMutation({
    mutationFn: disconnectGoogle,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['business-detail', activeBusinessId] });
    },
    onError: (err) => info.show('Error', getApiErrorMessage(err, 'Could not disconnect Google.')),
  });

  const handlePress = () => {
    if (disconnect.isPending) return;
    if (!connected) {
      promptConnectGoogle('Connect your Google Business Profile to sync reviews, posts, and photos.');
      return;
    }
    confirmSheet.confirm({
      title: 'Disconnect Google Business Profile?',
      message: 'Reviews, posts, and photos will stop syncing until you reconnect.',
      confirmLabel: 'Disconnect',
      destructive: true,
      onConfirm: () => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        disconnect.mutate();
      },
    });
  };

  return (
    <>
    <Pressable
      onPress={handlePress}
      // No `className` — react-native-css-interop can swallow onPress on
      // styled Pressables (see components/ui.tsx).
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}
    >
      <Text className="font-sans text-sm text-white">Google Business Profile</Text>
      <View className="flex-row items-center gap-1.5">
        <View className={`h-2 w-2 rounded-full ${connected ? 'bg-secondary' : 'bg-zinc-600'}`} />
        <Text className={`font-sans-semibold text-xs ${connected ? 'text-secondary' : 'text-zinc-500'}`}>
          {disconnect.isPending ? 'Disconnecting…' : connected ? 'Connected — tap to disconnect' : 'Tap to connect'}
        </Text>
      </View>
    </Pressable>
    {info.node}
    {confirmSheet.node}
    </>
  );
}

// --- Screen -----------------------------------------------------------------------

export default function SettingsScreen() {
  const { activeBusinessId } = useBusiness();

  const business = useQuery({
    queryKey: ['business-detail', activeBusinessId],
    queryFn: fetchBusinessDetail,
    enabled: !!activeBusinessId,
  });
  const prefs = useQuery({ queryKey: ['notification-prefs'], queryFn: fetchNotificationPrefs });

  return (
    <Screen>
      <ScreenTitle>Settings</ScreenTitle>
      <ScrollView contentContainerClassName="px-5 pb-12" keyboardShouldPersistTaps="handled">
        <SectionLabel>Business profile</SectionLabel>
        {business.isLoading ? (
          <Skeleton className="h-64" />
        ) : business.isError || !business.data ? (
          <EmptyState
            title="Couldn't load the business"
            hint={getApiErrorMessage(business.error, 'Try again.')}
          />
        ) : (
          <BusinessForm key={business.dataUpdatedAt} initial={business.data} />
        )}

        <SectionLabel>Notifications</SectionLabel>
        {prefs.isLoading ? (
          <Skeleton className="h-64" />
        ) : prefs.isError || !prefs.data ? (
          <Text className="px-1 font-sans text-sm text-zinc-500">Couldn't load notification preferences.</Text>
        ) : (
          <NotificationsSection key={prefs.dataUpdatedAt} initial={prefs.data} />
        )}

        <SectionLabel>Google Business Profile</SectionLabel>
        {business.isLoading ? (
          <Skeleton className="h-14" />
        ) : (
          <View className="overflow-hidden rounded-card border border-surface-border bg-surface-raised">
            <GoogleConnectionRow connected={business.data?.googleConnected ?? false} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
