import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  fetchPlaceDetails,
  searchPlaces,
  type PlaceDetails,
  type PlaceSuggestion,
} from '@/api/endpoints/onboarding';
import { ErrorText, Field } from '@/components/ui';
import { useTheme } from '@/lib/theme';

interface Props {
  onSelected: (placeId: string, details: PlaceDetails) => void;
}

/**
 * First onboarding step for a user with no workspace yet — mirrors the web
 * signup wizard's StepBusinessSearch: type the business name, pick the Google
 * Maps result, and its details autofill the next screen. There's deliberately
 * no "enter manually" bypass — every workspace should be matched to a real
 * Google Places result so googlePlaceId is set (rank tracking, SEO analyzer
 * and GBP insights all key off it).
 */
export function StepBusinessSearch({ onSelected }: Props) {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [fetchingDetails, setFetchingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce the autocomplete calls; skip the fetch triggered by our own
  // setQuery after a selection.
  const skipNext = useRef(false);
  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        setSuggestions(await searchPlaces(q));
      } catch (err) {
        setError(getApiErrorMessage(err, 'Could not search right now.'));
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  async function select(item: PlaceSuggestion) {
    skipNext.current = true;
    setQuery(item.mainText);
    setSuggestions([]);
    setFetchingDetails(true);
    setError(null);
    try {
      const details = await fetchPlaceDetails(item.placeId);
      onSelected(item.placeId, details);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load that business. Pick another, or try again.'));
    } finally {
      setFetchingDetails(false);
    }
  }

  return (
    <ScrollView
      contentContainerClassName="px-5 pb-16 pt-2"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="mb-1 font-display-bold text-lg text-white">Find your business</Text>
      <Text className="mb-5 font-sans text-sm leading-5 text-zinc-400">
        Search for your business on Google Maps and we&apos;ll fill in the details for you.
      </Text>

      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder="Start typing your business name…"
            autoFocus
            editable={!fetchingDetails}
          />
        </View>
        {(searching || fetchingDetails) && <ActivityIndicator color={t.brandBright} />}
      </View>

      <ErrorText>{error}</ErrorText>

      <View className="mt-3 overflow-hidden rounded-card border border-surface-border">
        {suggestions.map((item, i) => (
          <Pressable
            key={item.placeId}
            onPress={() => select(item)}
            disabled={fetchingDetails}
            // No `className` on the Pressable — react-native-css-interop can
            // swallow onPress on styled Pressables (see components/ui.tsx).
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 12,
              paddingHorizontal: 14,
              paddingVertical: 14,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: t.border,
              backgroundColor: t.card,
            }}
          >
            <Ionicons name="storefront-outline" size={18} color={t.textFaint} style={{ marginTop: 2 }} />
            <View className="flex-1">
              <Text className="font-sans-semibold text-sm text-white">{item.mainText}</Text>
              {!!item.secondaryText && (
                <Text className="mt-0.5 font-sans text-xs text-zinc-400">{item.secondaryText}</Text>
              )}
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
