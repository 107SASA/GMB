import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fetchCardEvents } from '@/api/endpoints/leads';
import { BottomSheet, Field, PrimaryButton } from '@/components/ui';
import { useTheme, withAlpha } from '@/lib/theme';

/**
 * "Where you met" picker for visiting-card scans.
 *
 * - The last event used in this workspace is pre-selected on every scan, so
 *   at a conference the owner never touches it.
 * - Tap → list of events already used in this workspace (server, so every
 *   phone in the team sees them), newest first, plus events used on this
 *   phone that are not saved yet (offline queue).
 * - "New event" → type once; it becomes the pre-selected one from then on.
 */

const lastKey = (businessId: string | null) => `cardScan.metAt.${businessId ?? 'none'}`;
const recentKey = (businessId: string | null) => `cardScan.recentEvents.${businessId ?? 'none'}`;
const MAX_RECENT = 20;

/** The event to pre-select (last used in this workspace on this phone). */
export async function loadLastEvent(businessId: string | null): Promise<string> {
  try {
    const v = await AsyncStorage.getItem(lastKey(businessId));
    // Builds before per-workspace events kept one global value.
    return v ?? (await AsyncStorage.getItem('cardScan.metAt')) ?? '';
  } catch {
    return '';
  }
}

/** Remember the chosen event: pre-selected next time, and listed even before any lead is saved with it. */
export async function rememberEvent(businessId: string | null, name: string): Promise<void> {
  const v = name.trim();
  try {
    await AsyncStorage.setItem(lastKey(businessId), v);
    if (!v) return;
    const raw = await AsyncStorage.getItem(recentKey(businessId));
    const list: string[] = raw ? JSON.parse(raw) : [];
    const next = [v, ...list.filter((e) => e.toLowerCase() !== v.toLowerCase())].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(recentKey(businessId), JSON.stringify(next));
  } catch {
    // Convenience only — the scan still works without it.
  }
}

export function EventPicker({
  businessId,
  value,
  onChange,
}: {
  businessId: string | null;
  value: string;
  onChange: (name: string) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [localRecent, setLocalRecent] = useState<string[]>([]);

  const events = useQuery({
    queryKey: ['card-events', businessId],
    queryFn: fetchCardEvents,
    enabled: !!businessId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    AsyncStorage.getItem(recentKey(businessId))
      .then((raw) => setLocalRecent(raw ? JSON.parse(raw) : []))
      .catch(() => setLocalRecent([]));
    void events.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, businessId]);

  // Server events (with counts) first by recency; then this phone's not-yet-saved ones.
  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; count: number | null }[] = [];
    const push = (name: string, count: number | null) => {
      const k = name.trim().toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push({ name: name.trim(), count });
    };
    if (value.trim()) push(value, (events.data ?? []).find((e) => e.name.toLowerCase() === value.trim().toLowerCase())?.count ?? null);
    for (const e of events.data ?? []) push(e.name, e.count);
    for (const e of localRecent) push(e, null);
    return out;
  }, [events.data, localRecent, value]);

  function choose(name: string) {
    onChange(name);
    void rememberEvent(businessId, name);
    setOpen(false);
    setAdding(false);
    setDraft('');
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Where you met: ${value || 'no event'}. Change`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          minHeight: 52,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: value ? withAlpha(t.brand, 0.6) : t.border,
          backgroundColor: value ? withAlpha(t.brand, 0.1) : t.card,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Ionicons name="location-outline" size={18} color={value ? t.brandBright : t.textFaint} />
        <Text numberOfLines={1} className={`flex-1 font-sans-semibold text-base ${value ? 'text-white' : 'text-zinc-500'}`}>
          {value || 'Pick or add an event'}
        </Text>
        <Text className="font-sans-semibold text-sm text-indigo-300">Change</Text>
        <Ionicons name="chevron-down" size={16} color={t.textFaint} />
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => {
          setOpen(false);
          setAdding(false);
        }}
      >
        <Text className="font-display-bold text-lg" style={{ color: t.text }}>Where did you meet?</Text>
        <Text className="mt-1 font-sans text-sm" style={{ color: t.textDim }}>
          Your choice stays selected for the next cards.
        </Text>

        {adding ? (
          <View style={{ marginTop: 16, gap: 10 }}>
            <Field value={draft} onChangeText={setDraft} placeholder="e.g. Delhi Expo 2026" autoFocus maxLength={60} returnKeyType="done" onSubmitEditing={() => draft.trim() && choose(draft)} />
            <PrimaryButton title="Use this event" disabled={!draft.trim()} onPress={() => choose(draft)} />
            <Pressable onPress={() => setAdding(false)} hitSlop={6} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }}>Back to list</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ marginTop: 14, gap: 8 }}>
            <Pressable
              onPress={() => setAdding(true)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: 50,
                borderRadius: 12,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: withAlpha(t.brand, 0.6),
                paddingHorizontal: 14,
              }}
            >
              <Ionicons name="add" size={20} color={t.brandBright} />
              <Text className="font-sans-semibold text-base text-indigo-300">New event</Text>
            </Pressable>

            {options.map((o) => {
              const selected = o.name.toLowerCase() === value.trim().toLowerCase();
              return (
                <Pressable
                  key={o.name}
                  onPress={() => choose(o.name)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 50,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: selected ? t.brand : t.border,
                    backgroundColor: selected ? withAlpha(t.brand, 0.12) : 'transparent',
                    paddingHorizontal: 14,
                  }}
                >
                  <Ionicons name={selected ? 'checkmark-circle' : 'location-outline'} size={18} color={selected ? t.brandBright : t.textFaint} />
                  <Text numberOfLines={1} className="flex-1 font-sans-semibold text-base text-zinc-200">{o.name}</Text>
                  {o.count != null && (
                    <Text className="font-sans text-xs text-zinc-500">
                      {o.count} {o.count === 1 ? 'card' : 'cards'}
                    </Text>
                  )}
                </Pressable>
              );
            })}

            {events.isLoading && options.length === 0 && (
              <Text className="font-sans text-sm text-zinc-500">Loading your events…</Text>
            )}

            <Pressable onPress={() => choose('')} style={{ alignItems: 'center', paddingVertical: 10 }}>
              <Text className="font-sans-semibold text-sm" style={{ color: value ? t.textDim : t.brandBright }}>
                {value ? 'No event for this card' : '✓ No event'}
              </Text>
            </Pressable>
          </View>
        )}
      </BottomSheet>
    </>
  );
}
