import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BottomSheet, ErrorText, Field, PrimaryButton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * Monthly investment for CRM ROI — the same setting as "Set monthly
 * investment" on the web CRM Analytics. ROI % = (revenue − investment) ÷
 * investment, where investment = this monthly amount × days ÷ 30.44.
 * Leaving it empty clears it and ROI shows as unavailable.
 */
export function InvestmentSheet({
  visible,
  initialMonthly,
  saving,
  error,
  onCancel,
  onSave,
}: {
  visible: boolean;
  initialMonthly: number | null;
  saving?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (monthlyAmount: number | null) => void;
}) {
  const t = useTheme();
  const [value, setValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setValue(initialMonthly != null ? String(initialMonthly) : '');
    setLocalError(null);
  }, [visible, initialMonthly]);

  function submit() {
    const raw = value.replace(/[,\s₹]/g, '');
    if (raw === '') {
      onSave(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) {
      setLocalError('Enter the amount you spend per month (0 or more).');
      return;
    }
    onSave(n);
  }

  return (
    <BottomSheet visible={visible} onClose={onCancel}>
      <Text className="font-display-bold text-lg" style={{ color: t.text }}>Monthly investment</Text>
      <Text className="mt-1 font-sans text-sm leading-5" style={{ color: t.textDim }}>
        How much do you spend each month to get leads? Count whatever you want, for example your GrowwMatics plan, ads and staff.
      </Text>
      <View className="mt-4">
        <Field value={value} onChangeText={setValue} placeholder="Amount per month in ₹, e.g. 15000" keyboardType="decimal-pad" />
      </View>
      <Text className="mt-2 font-sans text-xs leading-4" style={{ color: t.textFaint }}>
        ROI = (revenue from won leads − investment) ÷ investment. Leave empty to turn ROI off.
      </Text>
      {!!(localError || error) && (
        <View className="mt-3">
          <ErrorText>{localError || error}</ErrorText>
        </View>
      )}
      <View className="mt-4">
        <PrimaryButton title="Save" loading={saving} onPress={submit} />
      </View>
      <Pressable onPress={onCancel} style={{ marginTop: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }}>Cancel</Text>
      </Pressable>
    </BottomSheet>
  );
}
