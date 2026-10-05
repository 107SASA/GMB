import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { DealInput } from '@/api/endpoints/leads';
import { BottomSheet, Chip, ErrorText, Field, PrimaryButton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'];

/**
 * Asked when a lead is moved to Won. Revenue / ROI are built only from the
 * amount entered here — nothing is estimated. Cancel keeps the lead where it was.
 */
export function DealValueSheet({
  visible,
  leadName,
  initial,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  leadName: string;
  initial?: { value: number | null; currency: string } | null;
  saving?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (deal: DealInput) => void;
}) {
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [notes, setNotes] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const t = useTheme();

  useEffect(() => {
    if (!visible) return;
    setValue(initial?.value != null ? String(initial.value) : '');
    setCurrency(initial?.currency || 'INR');
    setNotes('');
    setLocalError(null);
  }, [visible, initial?.value, initial?.currency]);

  function submit() {
    const n = Number(value.replace(/,/g, ''));
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) {
      setLocalError('Enter the deal amount (0 or more).');
      return;
    }
    onConfirm({ value: n, currency, closedAt: new Date().toISOString(), notes: notes.trim() || undefined });
  }

  return (
    <BottomSheet visible={visible} onClose={onCancel}>
          <Text className="font-display-bold text-lg" style={{ color: t.text }}>Deal won</Text>
          <Text className="mt-1 font-sans text-sm" style={{ color: t.textDim }}>
            What was the deal value for {leadName}?
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            {CURRENCIES.map((c) => (
              <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
            ))}
          </View>
          <View className="mt-3">
            <Field value={value} onChangeText={setValue} placeholder="Amount, e.g. 25000" keyboardType="decimal-pad" />
          </View>
          <View className="mt-3">
            <Field value={notes} onChangeText={setNotes} placeholder="Notes (optional)" />
          </View>
          {!!(localError || error) && (
            <View className="mt-3">
              <ErrorText>{localError || error}</ErrorText>
            </View>
          )}
          <View className="mt-4">
            <PrimaryButton title="Mark as won" loading={saving} onPress={submit} />
          </View>
          <Pressable onPress={onCancel} style={{ marginTop: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }}>Cancel</Text>
          </Pressable>
    </BottomSheet>
  );
}
