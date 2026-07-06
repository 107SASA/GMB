import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  fetchBusinessDetail,
  fetchIntegrationsStatus,
  fetchNotificationPrefs,
  NOTIFICATION_PREFS,
  updateBusinessDetail,
  updateNotificationPrefs,
  type BusinessDetail,
  type NotificationPrefs,
} from '@/api/endpoints/account';
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
} from '@/components/ui';
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
      Alert.alert('Saved', 'Business profile updated.');
      void queryClient.invalidateQueries({ queryKey: ['business-detail', activeBusinessId] });
      // The switcher list shows name/category — keep it in sync.
      void queryClient.invalidateQueries({ queryKey: ['businesses'] });
    },
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not save the profile.')),
  });

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  function addKeyword() {
    const value = keywordInput.trim();
    if (!value || keywords.includes(value)) return;
    if (keywords.length >= 20) {
      Alert.alert('Limit reached', 'You can save up to 20 keywords.');
      return;
    }
    setKeywords([...keywords, value]);
    setKeywordInput('');
  }

  return (
    <View>
      <LabeledField label="Business name" value={form.name} onChangeText={set('name')} />
      <LabeledField label="Category" value={form.category} onChangeText={set('category')} />
      <Text className="mb-1.5 px-1 text-xs font-medium text-zinc-400">Description</Text>
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

      <Text className="mb-1.5 px-1 text-xs font-medium text-zinc-400">Keywords (max 20)</Text>
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
          className="items-center justify-center rounded-xl border border-surface-border bg-surface-raised px-4 active:opacity-80"
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
    </View>
  );
}

// --- Notifications ---------------------------------------------------------------

function NotificationsSection({ initial }: { initial: NotificationPrefs }) {
  const t = useTheme();
  const [prefs, setPrefs] = useState(initial);

  const save = useMutation({
    mutationFn: ({ next }: { next: NotificationPrefs; key: keyof NotificationPrefs }) =>
      updateNotificationPrefs(next),
    onError: (err, { key, next }) => {
      // Auto-save per toggle: roll just this switch back on failure.
      setPrefs((current) => ({ ...current, [key]: !next[key] }));
      Alert.alert('Error', getApiErrorMessage(err, 'Could not update preferences.'));
    },
  });

  function toggle(key: keyof NotificationPrefs, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    save.mutate({ next, key });
  }

  return (
    <View className="overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
      {NOTIFICATION_PREFS.map(({ key, label }, i) => (
        <View
          key={key}
          className={`flex-row items-center justify-between px-4 py-3 ${
            i > 0 ? 'border-t border-surface-border' : ''
          }`}
        >
          <Text className="flex-1 text-sm text-white">{label}</Text>
          <Switch
            value={prefs[key]}
            onValueChange={(v) => toggle(key, v)}
            trackColor={{ false: t.border, true: t.brand }}
            thumbColor="#ffffff"
          />
        </View>
      ))}
    </View>
  );
}

// --- Integrations ----------------------------------------------------------------

function IntegrationRow({ label, connected }: { label: string; connected: boolean }) {
  return (
    <View className="flex-row items-center justify-between px-4 py-3">
      <Text className="text-sm text-white">{label}</Text>
      <View className="flex-row items-center gap-1.5">
        <View
          className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-zinc-600'}`}
        />
        <Text className={`text-xs ${connected ? 'text-emerald-400' : 'text-zinc-500'}`}>
          {connected ? 'Connected' : 'Not configured'}
        </Text>
      </View>
    </View>
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
  const integrations = useQuery({
    queryKey: ['integrations-status'],
    queryFn: fetchIntegrationsStatus,
  });

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
          <Text className="px-1 text-sm text-zinc-500">Couldn't load notification preferences.</Text>
        ) : (
          <NotificationsSection key={prefs.dataUpdatedAt} initial={prefs.data} />
        )}

        <SectionLabel>Integrations</SectionLabel>
        {integrations.isLoading ? (
          <Skeleton className="h-40" />
        ) : integrations.isError || !integrations.data ? (
          <Text className="px-1 text-sm text-zinc-500">Couldn't load integration status.</Text>
        ) : (
          <View className="overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
            <IntegrationRow
              label="Google Business Profile"
              connected={business.data?.googleConnected ?? false}
            />
            <View className="border-t border-surface-border">
              <IntegrationRow label="Google Places" connected={integrations.data.googlePlaces} />
            </View>
            <View className="border-t border-surface-border">
              <IntegrationRow label="WhatsApp (Twilio)" connected={integrations.data.twilio} />
            </View>
            <View className="border-t border-surface-border">
              <IntegrationRow label="AI engine (Groq)" connected={integrations.data.groq} />
            </View>
            <View className="border-t border-surface-border">
              <IntegrationRow label="Rank tracking (SerpAPI)" connected={integrations.data.serpapi} />
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
