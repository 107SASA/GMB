import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, Field } from '@/components/ui';
import {
  COUNTRY_CODES,
  DEFAULT_COUNTRY,
  countryForDialCode,
  splitPhone,
  type CountryCode,
} from '@/lib/countryCodes';
import { useTheme } from '@/lib/theme';

/**
 * Country-code dropdown + local number, matching the website login's
 * PhoneNumberInput. `value` / `onChange` carry one E.164-style string
 * ("+91XXXXXXXXXX") so the phone-login API stays unchanged.
 */
export function PhoneNumberField({
  value,
  onChange,
  editable = true,
  onSubmitEditing,
}: {
  value: string;
  onChange: (fullPhone: string) => void;
  editable?: boolean;
  onSubmitEditing?: () => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [iso2, setIso2] = useState(() => countryForDialCode(splitPhone(value).dialCode).iso2);

  const country = COUNTRY_CODES.find((c) => c.iso2 === iso2) ?? DEFAULT_COUNTRY;
  const localNumber = value.startsWith(country.dialCode)
    ? value.slice(country.dialCode.length).replace(/\D/g, '')
    : splitPhone(value).localNumber.replace(/\D/g, '');
  const maxLocal = 15 - country.dialCode.replace(/\D/g, '').length;

  function commit(next: CountryCode, digits: string) {
    setIso2(next.iso2);
    onChange(digits ? `${next.dialCode}${digits}` : next.dialCode);
  }

  function onLocalChange(raw: string) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('+')) {
      const cleaned = `+${trimmed.replace(/\D/g, '')}`;
      const split = splitPhone(cleaned);
      const match = countryForDialCode(split.dialCode);
      const digits = split.localNumber.replace(/\D/g, '').slice(0, 15 - match.dialCode.replace(/\D/g, '').length);
      if (digits) {
        commit(match, digits);
        return;
      }
    }
    commit(country, raw.replace(/\D/g, '').slice(0, maxLocal));
  }

  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: focused ? t.brand : t.border,
          backgroundColor: t.card,
          overflow: 'hidden',
        }}
      >
        <Pressable
          onPress={() => editable && setOpen(true)}
          disabled={!editable}
          accessibilityRole="button"
          accessibilityLabel="Country code"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 12,
            alignSelf: 'stretch',
            borderRightWidth: 1,
            borderRightColor: t.border,
          }}
        >
          <Text style={{ fontSize: 18 }}>{country.flag}</Text>
          <Text className="font-sans-semibold text-base" style={{ color: t.text }}>
            {country.dialCode}
          </Text>
          <Ionicons name="chevron-down" size={14} color={t.textFaint} />
        </Pressable>
        <TextInput
          value={localNumber}
          onChangeText={onLocalChange}
          editable={editable}
          placeholder="98765 43210"
          placeholderTextColor={t.textFaint}
          selectionColor={t.brandBright}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          maxLength={maxLocal}
          onSubmitEditing={onSubmitEditing}
          returnKeyType="go"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel="Mobile number"
          className="font-sans"
          style={{
            flex: 1,
            minWidth: 0,
            paddingHorizontal: 12,
            paddingVertical: 14,
            fontSize: 16,
            color: t.text,
          }}
        />
      </View>
      <CountryCodePicker
        visible={open}
        selectedIso2={country.iso2}
        onClose={() => setOpen(false)}
        onSelect={(next) => {
          commit(next, localNumber);
          setOpen(false);
        }}
      />
    </>
  );
}

function CountryCodePicker({
  visible,
  selectedIso2,
  onClose,
  onSelect,
}: {
  visible: boolean;
  selectedIso2: string;
  onClose: () => void;
  onSelect: (country: CountryCode) => void;
}) {
  const t = useTheme();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^\+/, '');
    if (!q) return COUNTRY_CODES;
    return COUNTRY_CODES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iso2.toLowerCase().includes(q) ||
        c.dialCode.replace('+', '').startsWith(q)
    );
  }, [search]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => setSearch('')}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom', 'left', 'right']}>
        <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3">
          <Text className="flex-1 font-display-bold text-lg" style={{ color: t.text }} numberOfLines={1}>
            Country code
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityLabel="Close"
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={22} color={t.text} />
          </Pressable>
        </View>
        <View className="px-4 py-3">
          <Field
            value={search}
            onChangeText={setSearch}
            placeholder="Search country or code"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.iso2}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<EmptyState title="No countries found" hint="Try a country name or dial code." />}
          renderItem={({ item }) => {
            const selected = item.iso2 === selectedIso2;
            return (
              <Pressable
                onPress={() => onSelect(item)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={{
                  minHeight: 56,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: t.border,
                }}
              >
                <Text style={{ fontSize: 22, width: 32 }}>{item.flag}</Text>
                <Text className="flex-1 font-sans-semibold text-base" style={{ color: t.text }} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text className="font-sans text-base" style={{ color: t.textDim }}>
                  {item.dialCode}
                </Text>
                {selected && <Ionicons name="checkmark" size={18} color={t.brandBright} />}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}
