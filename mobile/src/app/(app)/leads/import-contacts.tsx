import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Contacts from 'expo-contacts';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { bulkImportLeads } from '@/api/endpoints/leads';
import { useBusiness } from '@/business/BusinessContext';
import { useCrmCaptureConsent } from '@/components/consent-sheet';
import {
  BackChevron, EmptyState, ErrorText, Field, LoadingScreen, PrimaryButton, Screen
} from '@/components/ui';
import { parsePhoneCandidate } from '@/lib/phone';

const MAX_SELECTION = 200; // matches the bulk-import API cap

type PickerContact = { key: string; name: string; phone: string };

type PermissionState = 'pending' | 'granted' | 'denied' | 'declined-consent';

/**
 * Store-policy notes (Play "User Data" / App Store 5.1.1):
 *  - Permission is requested only AFTER the user lands here via an explicit
 *    "Add from contacts" tap and accepts the in-app consent sheet.
 *  - Only the rows the user selects are ever sent to the server — never the
 *    full address book. Do not "optimize" this into a background sync.
 */
export default function ImportContactsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const { ensureConsent, consentSheet } = useCrmCaptureConsent();

  const [permission, setPermission] = useState<PermissionState>('pending');
  const [contacts, setContacts] = useState<PickerContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await ensureConsent())) {
        if (!cancelled) {
          setPermission('declined-consent');
          setLoading(false);
        }
        return;
      }
      const { status } = await Contacts.requestPermissionsAsync();
      if (cancelled) return;
      if (status !== Contacts.PermissionStatus.GRANTED) {
        setPermission('denied');
        setLoading(false);
        return;
      }
      setPermission('granted');
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
      });
      if (cancelled) return;
      const rows: PickerContact[] = [];
      for (const c of data) {
        const phone = parsePhoneCandidate(c.phoneNumbers?.[0]?.number);
        if (!phone || !c.name) continue;
        rows.push({ key: c.id ?? `${c.name}-${phone}`, name: c.name, phone });
      }
      rows.sort((a, b) => a.name.localeCompare(b.name));
      setContacts(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\s/g, ''))
    );
  }, [contacts, search]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < MAX_SELECTION) next.add(key);
      return next;
    });
  }

  const importSelected = useMutation({
    mutationFn: () =>
      bulkImportLeads(
        contacts
          .filter((c) => selected.has(c.key))
          .map((c) => ({ name: c.name, phone: c.phone }))
      ),
    onMutate: () => setError(null),
    onSuccess: (res) => {
      setResult({ created: res.created, skipped: res.skipped });
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ['crm-leads', activeBusinessId] });
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Import failed.')),
  });

  if (loading) {
    return (
      <Screen>
        {consentSheet}
        <LoadingScreen />
      </Screen>
    );
  }

  return (
    <Screen>
      {consentSheet}
      {/* Header */}
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
        <Pressable onPress={() => router.back()} hitSlop={8} className="active:opacity-60">
          <BackChevron />
        </Pressable>
        <Text className="flex-1 text-lg font-bold text-white">Add from contacts</Text>
        {selected.size > 0 && (
          <Text className="text-sm font-medium text-indigo-300">{selected.size} selected</Text>
        )}
      </View>

      {permission === 'declined-consent' ? (
        <EmptyState
          title="Import cancelled"
          hint="Contacts are only imported after you agree to save selected entries to your CRM."
        />
      ) : permission === 'denied' ? (
        <EmptyState
          title="Contacts permission needed"
          hint="Allow contact access in system settings to pick contacts to import."
          action={
            <Pressable
              onPress={() => void Linking.openSettings()}
              className="mt-2 rounded-xl bg-brand px-5 py-3 active:opacity-80"
            >
              <Text className="text-sm font-semibold text-on-brand">Open settings</Text>
            </Pressable>
          }
        />
      ) : (
        <>
          <View className="px-5 py-3">
            <Field
              value={search}
              onChangeText={setSearch}
              placeholder="Search contacts…"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {!!result && (
            <View className="mx-5 mb-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3">
              <Text className="text-sm text-emerald-400">
                {result.created} added, {result.skipped} already in CRM.
              </Text>
            </View>
          )}
          {!!error && (
            <View className="px-5 pb-2">
              <ErrorText>{error}</ErrorText>
            </View>
          )}

          <FlatList
            data={filtered}
            keyExtractor={(c) => c.key}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isSelected = selected.has(item.key);
              return (
                <Pressable
                  onPress={() => toggle(item.key)}
                  className="flex-row items-center gap-3 border-b border-surface-border px-5 py-3 active:bg-surface-raised"
                >
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={isSelected ? '#6366F1' : '#4A5175'}
                  />
                  <View className="flex-1">
                    <Text className="text-base text-white" numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text className="text-xs text-zinc-500">{item.phone}</Text>
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <EmptyState
                title={search ? 'No matching contacts' : 'No contacts with phone numbers'}
              />
            }
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 8 }}
          />

          {selected.size > 0 && (
            <View className="border-t border-surface-border px-5 py-3">
              <PrimaryButton
                title={`Import ${selected.size} contact${selected.size === 1 ? '' : 's'}`}
                loading={importSelected.isPending}
                onPress={() => importSelected.mutate()}
              />
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
