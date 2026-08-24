import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
// SDK 57: `import * as Contacts` + Contacts.getContactsAsync()/Contacts.Fields/
// Contacts.PermissionStatus is the OLD, now-deprecated surface —
// getContactsAsync throws at runtime if called (confirmed against this
// version's actual installed type defs, node_modules/expo-contacts/build/
// ContactsModule.d.ts — this was exactly the "could not fetch contacts"
// bug, same root cause as contact-picker-modal.tsx). requestPermissionsAsync
// is now a top-level named export (not on a `Contacts` namespace object —
// that name doesn't exist in this package's exports at all);
// Contact.getAllDetails() replaces getContactsAsync(); permission status is
// a plain string ('granted'), not the old enum.
import { Contact, ContactField, requestPermissionsAsync } from 'expo-contacts';
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
import { useTheme } from '@/lib/theme';

const MAX_SELECTION = 200; // matches the bulk-import API cap

type PickerContact = { key: string; name: string; phone: string };

type PermissionState = 'pending' | 'granted' | 'denied' | 'declined-consent' | 'error';

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
  const t = useTheme();

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
      // Was unguarded — any failure here (ensureConsent, the permission
      // request, or getContactsAsync itself throwing — e.g. a native/
      // provider error, not just a permission denial) surfaced as an
      // unhandled promise rejection: a hard crash instead of a graceful
      // fallback, and `loading` stuck true forever if it didn't crash the
      // app outright (see the same fix in contact-picker-modal.tsx).
      try {
        if (!(await ensureConsent())) {
          if (!cancelled) {
            setPermission('declined-consent');
            setLoading(false);
          }
          return;
        }
        const perm = await requestPermissionsAsync();
        if (cancelled) return;
        if (perm.status !== 'granted') {
          setPermission('denied');
          setLoading(false);
          return;
        }
        setPermission('granted');
        // limit is required here (unlike the old getContactsAsync, this
        // doesn't implicitly return "everything") — set generously high
        // since this screen searches the full list, not just a first page.
        const data = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES], {
          limit: 10000,
        });
        if (cancelled) return;
        const rows: PickerContact[] = [];
        for (const c of data) {
          const phone = parsePhoneCandidate(c.phones?.[0]?.number);
          if (!phone || !c.fullName) continue;
          rows.push({ key: c.id ?? `${c.fullName}-${phone}`, name: c.fullName, phone });
        }
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setContacts(rows);
        setLoading(false);
      } catch (err) {
        console.warn('[ImportContactsScreen] failed to load contacts:', err);
        if (!cancelled) {
          setPermission('error');
          setLoading(false);
        }
      }
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
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <BackChevron />
        </Pressable>
        <Text className="flex-1 font-display-bold text-lg text-white">Add from contacts</Text>
        {selected.size > 0 && (
          <Text className="font-sans-semibold text-sm text-indigo-300">
            {selected.size} selected
          </Text>
        )}
      </View>

      {permission === 'declined-consent' ? (
        <EmptyState
          title="Import cancelled"
          hint="Contacts are only imported after you agree to save selected entries to your CRM."
        />
      ) : permission === 'error' ? (
        <EmptyState
          title="Couldn't load contacts"
          hint="Something went wrong reading your contacts. Please try again."
        />
      ) : permission === 'denied' ? (
        <EmptyState
          title="Contacts permission needed"
          hint="Allow contact access in system settings to pick contacts to import."
          action={
            <Pressable
              onPress={() => void Linking.openSettings()}
              // No `className` — react-native-css-interop can swallow onPress
              // on styled Pressables (see components/ui.tsx).
              style={{ marginTop: 8, borderRadius: 999, backgroundColor: t.brand, paddingHorizontal: 20, paddingVertical: 12 }}
            >
              <Text className="font-sans-bold text-sm text-on-brand">Open settings</Text>
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
            <View className="mx-5 mb-2 rounded-xl border border-secondary/20 bg-secondary-container/40 px-4 py-3">
              <Text className="font-sans-semibold text-sm text-secondary">
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
                  // No `className` — see note above.
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: t.border,
                    paddingHorizontal: 20,
                    paddingVertical: 12,
                  }}
                >
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={isSelected ? t.brandBright : t.textFaint}
                  />
                  <View className="flex-1">
                    <Text className="font-sans text-base text-white" numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text className="font-sans text-xs text-zinc-500">{item.phone}</Text>
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
