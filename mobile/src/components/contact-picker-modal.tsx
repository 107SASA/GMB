import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Linking, Modal, Pressable, Text, View } from 'react-native';

import { EmptyState, Field, LoadingScreen } from '@/components/ui';
import { parsePhoneCandidate } from '@/lib/phone';
import { useTheme } from '@/lib/theme';

type PickerContact = { key: string; name: string; phone: string };
type Status = 'loading' | 'granted' | 'denied';

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
      const { status: perm } = await Contacts.requestPermissionsAsync();
      if (cancelled) return;
      if (perm !== Contacts.PermissionStatus.GRANTED) {
        setStatus('denied');
        return;
      }
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
      if (cancelled) return;
      const rows: PickerContact[] = [];
      for (const c of data) {
        const phone = parsePhoneCandidate(c.phoneNumbers?.[0]?.number);
        if (!phone || !c.name) continue;
        rows.push({ key: c.id ?? `${c.name}-${phone}`, name: c.name, phone });
      }
      rows.sort((a, b) => a.name.localeCompare(b.name));
      if (!cancelled) {
        setContacts(rows);
        setStatus('granted');
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
