import DateTimePicker from '@react-native-community/datetimepicker';
import { useCallback, useState } from 'react';
import { Modal, Platform, Pressable, Text, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

/**
 * Imperative single time OR date picking (datetime-picker.tsx does both in
 * one go). Android shows the native dialog; iOS a bottom sheet with a
 * spinner (time) or calendar (date) and Cancel/Done. Render `{element}` once
 * in the screen; call `open(mode, initial, onPick)`.
 */

/** "09:30" → a Date today at that time (or `fallback` when blank/invalid). */
export function timeToDate(hhmm: string, fallback = '09:00'): Date {
  const [h, m] = (/^\d{2}:\d{2}$/.test(hhmm) ? hhmm : fallback).split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

export function dateToTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "09:30" → "9:30 AM". */
export function timeLabel(hhmm: string): string {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Local calendar date as "YYYY-MM-DD" (not toISOString — that shifts across midnight in UTC+). */
export function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-12-25" → "Fri, 25 Dec 2026". */
export function ymdLabel(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

type Mode = 'time' | 'date';

export function useTimeDatePicker() {
  const [state, setState] = useState<{ mode: Mode; value: Date; title?: string; onPick: (date: Date) => void } | null>(null);
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const scheme = useColorScheme();

  const open = useCallback((mode: Mode, initial: Date, onPick: (date: Date) => void, title?: string) => {
    setState({ mode, value: initial, title, onPick });
  }, []);

  let element: React.ReactNode = null;
  if (state && Platform.OS === 'android') {
    element = (
      <DateTimePicker
        value={state.value}
        mode={state.mode}
        minimumDate={state.mode === 'date' ? new Date() : undefined}
        onChange={(event, selected) => {
          const onPick = state.onPick;
          setState(null);
          if (event.type === 'set' && selected) onPick(selected);
        }}
      />
    );
  } else if (state) {
    element = (
      <Modal transparent animationType="slide" onRequestClose={() => setState(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={() => setState(null)} />
        <View
          className="rounded-t-2xl border-t border-surface-border bg-surface-raised"
          // Phone: full width. iPad: a centred sheet, not a 1000pt-wide calendar.
          style={{ width: '100%', maxWidth: 520, alignSelf: 'center', paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <View className="flex-row items-center justify-between px-4">
            <Pressable onPress={() => setState(null)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}>
              <Text className="font-sans-semibold text-base" style={{ color: t.textDim }}>Cancel</Text>
            </Pressable>
            {!!state.title && <Text className="font-sans-bold text-base" style={{ color: t.text }}>{state.title}</Text>}
            <Pressable
              onPress={() => {
                const { value, onPick } = state;
                setState(null);
                onPick(value);
              }}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}
            >
              <Text className="font-sans-bold text-base" style={{ color: t.brandBright }}>Done</Text>
            </Pressable>
          </View>
          <DateTimePicker
            value={state.value}
            mode={state.mode}
            display={state.mode === 'date' ? 'inline' : 'spinner'}
            minimumDate={state.mode === 'date' ? new Date() : undefined}
            themeVariant={scheme === 'light' ? 'light' : 'dark'}
            accentColor={t.brand}
            onChange={(_, selected) => {
              if (selected) setState((s) => (s ? { ...s, value: selected } : s));
            }}
          />
        </View>
      </Modal>
    );
  }

  return { open, element };
}
