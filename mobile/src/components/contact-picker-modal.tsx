import { Ionicons } from '@expo/vector-icons';
// SDK 57: `import * as Contacts` + Contacts.getContactsAsync()/Contacts.Fields/
// Contacts.PermissionStatus is the OLD, now-deprecated surface —
// getContactsAsync throws at runtime if called (confirmed against this
// version's actual installed type defs, node_modules/expo-contacts/build/
// ContactsModule.d.ts — this was exactly the "could not fetch contacts"
// bug). requestPermissionsAsync is now a top-level named export (not on a
// `Contacts` namespace object — that name doesn't exist in this package's
// exports at all); Contact.getAllDetails() replaces getContactsAsync();
// permission status is a plain string ('granted'), not the old enum.
import { Contact, ContactField, requestPermissionsAsync } from 'expo-contacts';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Linking, Modal, Pressable, Text, View } from 'react-native';

import { EmptyState, Field, LoadingScreen } from '@/components/ui';
import { parsePhoneCandidate } from '@/lib/phone';
import { useTheme } from '@/lib/theme';

type PickerContact = { key: string; name: string; phone: string };
type Status = 'loading' | 'granted' | 'denied' | 'error';

/**
 * Single-contact picker — opens the device's contact list, tapping one
 * returns it via `onPick` and closes. Distinct from leads/import-contacts.tsx
 * (that screen is bulk CRM-lead import, a different feature/data model —
 * see the comment on Home's AddCustomerCard). No CRM consent sheet here:
 * unlike bulk import, nothing is saved anywhere just by picking a contact —
 * it only fills a form field the user still has to explicitly submit
 * themselves, same as if they'd typed the number in by hand.
 */
export function ContactPickerModal({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (contact: { name: string; phone: string }) => void;
}) {
  const t = useTheme();
  const [status, setStatus] = useState<Status>('loading');
  const [contacts, setContacts] = useState<PickerContact[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setStatus('loading');
    setSearch('');
    void (async () => {
      // Was unguarded — any failure here (a native/provider error, not just
      // a permission denial, e.g. no contacts provider available on some
      // Android builds) surfaced as an unhandled promise rejection: a hard
      // crash screen instead of a graceful fallback, and `status` stuck on
      // 'loading' forever if it happened to not crash the app outright.
      try {
        const perm = await requestPermissionsAsync();
        if (cancelled) return;
        if (perm.status !== 'granted') {
          setStatus('denied');
          return;
        }
        // limit is required here (unlike the old getContactsAsync, this
        // doesn't implicitly return "everything") — set generously high
        // since this picker searches the full list, not just a first page.
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
        if (!cancelled) {
          setContacts(rows);
          setStatus('granted');
        }
      } catch (err) {
        console.warn('[ContactPickerModal] failed to load contacts:', err);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\s/g, ''))
    );
  }, [contacts, search]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-surface pt-14">
        <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3">
          <Text className="flex-1 font-display-bold text-lg text-white">Pick a contact</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={t.text} />
          </Pressable>
        </View>

        {status === 'loading' ? (
          <LoadingScreen />
        ) : status === 'denied' ? (
          <EmptyState
            title="Contacts permission needed"
            hint="Allow contact access in system settings to pick a contact."
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
        ) : status === 'error' ? (
          <EmptyState
            title="Couldn't load contacts"
            hint="Something went wrong reading your contacts. You can still enter the number by hand."
          />
        ) : (
          <>
            <View className="px-4 py-3">
              <Field value={search} onChangeText={setSearch} placeholder="Search contacts" autoCapitalize="none" />
            </View>
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.key}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<EmptyState title="No contacts found" />}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onPick({ name: item.name, phone: item.phone })}
                  style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.border }}
                >
                  <Text className="font-sans-semibold text-base text-white">{item.name}</Text>
                  <Text className="mt-0.5 font-sans text-sm text-zinc-400">{item.phone}</Text>
                </Pressable>
              )}
            />
          </>
        )}
      </View>
    </Modal>
  );
}
