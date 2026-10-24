import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { answerWeeklyOffer, fetchWeeklyOffer } from '@/api/endpoints/weeklyOffer';
import { useBusiness } from '@/business/BusinessContext';
import { Card, ErrorText, Field, PrimaryButton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * "Anything to promote this week?" — asked once per week (the answer is
 * stored server-side, so it doesn't come back until next week on any
 * device). Only the owner's words become an offer post; nothing is invented.
 */
export function WeeklyOfferCard() {
  const t = useTheme();
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [festivalName, setFestivalName] = useState<string | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const state = useQuery({
    queryKey: ['weekly-offer', activeBusinessId],
    queryFn: fetchWeeklyOffer,
    enabled: !!activeBusinessId,
  });
  const answer = useMutation({
    mutationFn: answerWeeklyOffer,
    onSuccess: (_d, input) => {
      setDone(input.answer === 'yes' ? "Got it — your offer will be one of this week's Google posts, in your words." : null);
      void queryClient.invalidateQueries({ queryKey: ['weekly-offer', activeBusinessId] });
      void queryClient.invalidateQueries({ queryKey: ['weekly-offer-stored', activeBusinessId] });
    },
  });

  if (done) {
    return (
      <View className="mx-4 mt-4">
        <Card>
          <Text className="font-sans text-sm text-zinc-300">{done}</Text>
        </Card>
      </View>
    );
  }
  const s = state.data;
  if (!s || !s.eligible || s.answered) return null;
  const upcoming = s.festivals[0];
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      // No `className` — react-native-css-interop can swallow onPress on styled Pressables.
      style={{ borderRadius: 999, borderWidth: 1, borderColor: active ? t.brandBright : t.border, paddingHorizontal: 12, paddingVertical: 6 }}
    >
      <Text className="font-sans-semibold text-xs" style={{ color: active ? t.brandBright : t.textFaint }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View className="mx-4 mt-4">
      <Card>
        <View className="flex-row items-start gap-3">
          <Ionicons name="pricetag-outline" size={20} color={t.brandBright} />
          <View className="flex-1">
            <Text className="font-sans-bold text-base text-white">Anything to promote this week?</Text>
            <Text className="mt-1 font-sans text-sm text-zinc-400">
              An offer, a new service or an announcement — we&apos;ll make it one of this week&apos;s Google posts,
              using only your words.
              {upcoming ? ` ${upcoming.name} is on ${upcoming.date}${upcoming.approximate ? ' (approx.)' : ''}.` : ''}
            </Text>
          </View>
          <Pressable onPress={() => answer.mutate({ answer: 'dismiss' })} hitSlop={10} accessibilityLabel="Dismiss for this week">
            <Ionicons name="close" size={18} color={t.textFaint} />
          </Pressable>
        </View>

        {!writing ? (
          <View className="mt-3 flex-row items-center gap-4">
            <View className="flex-1">
              <PrimaryButton title="Yes, add it" onPress={() => setWriting(true)} />
            </View>
            <Pressable onPress={() => answer.mutate({ answer: 'no' })} hitSlop={8}>
              <Text className="font-sans-semibold text-sm text-zinc-400">Nothing this week</Text>
            </Pressable>
          </View>
        ) : (
          <View className="mt-3 gap-3">
            <Field
              value={text}
              onChangeText={setText}
              multiline
              maxLength={600}
              placeholder="e.g. 10% off tile installation booked before 15 October"
              className="min-h-20"
              textAlignVertical="top"
            />
            {s.festivals.length > 0 && (
              <View className="flex-row flex-wrap gap-2">
                {chip('Not for a festival', festivalName === null, () => setFestivalName(null))}
                {s.festivals.map((f) => chip(`For ${f.name}`, festivalName === f.name, () => setFestivalName(f.name)))}
              </View>
            )}
            {s.photos.length > 0 && (
              <View>
                <Text className="mb-1.5 font-sans text-xs text-zinc-500">Photo (optional, from your Photos)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {s.photos.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => setImageId(imageId === p.id ? null : p.id)}
                      style={{ borderRadius: 10, borderWidth: 2, borderColor: imageId === p.id ? t.brandBright : 'transparent', overflow: 'hidden' }}
                    >
                      <Image source={{ uri: p.url }} style={{ width: 56, height: 56 }} contentFit="cover" />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
            {answer.isError && <ErrorText>{getApiErrorMessage(answer.error, 'Could not save your offer.')}</ErrorText>}
            <View className="flex-row items-center gap-4">
              <View className="flex-1">
                <PrimaryButton
                  title="Use this offer"
                  loading={answer.isPending}
                  disabled={text.trim().length < 5}
                  onPress={() =>
                    answer.mutate({ answer: 'yes', text: text.trim(), ...(festivalName ? { festivalName } : {}), ...(imageId ? { imageId } : {}) })
                  }
                />
              </View>
              <Pressable onPress={() => setWriting(false)} hitSlop={8}>
                <Text className="font-sans-semibold text-sm text-zinc-400">Back</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Card>
    </View>
  );
}
