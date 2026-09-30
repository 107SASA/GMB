import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { z } from 'zod';

import { api, getApiErrorMessage } from '@/api/client';
import { useBusiness } from '@/business/BusinessContext';
import { ErrorText, Field, PrimaryButton } from '@/components/ui';

/**
 * Brand colours for generated post images — mirrors the web settings card
 * (GET/POST /api/business/brand). Colours saved here always win and are never
 * overwritten; with none saved they come from the logo, then the website,
 * then a neutral palette. The customer's logo (from Photos) is the only logo
 * placed on images — never GrowwMatics'.
 */
const brandSchema = z.object({
  manualColors: z.array(z.string()).catch([]),
  colors: z.array(z.string()).catch([]),
  colorSource: z.string().nullable().catch(null),
  logoUrl: z.string().nullable().catch(null),
  logoSource: z.string().nullable().catch(null),
});
const SOURCE_LABEL: Record<string, string> = {
  manual: 'set by you',
  logo: 'from your logo',
  website: 'from your website',
  theme: "from your website's theme colour",
  default: 'neutral default',
};
const HEX = /^#[0-9a-fA-F]{6}$/;

export function BrandColorsSection() {
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const brand = useQuery({
    queryKey: ['brand', activeBusinessId],
    queryFn: async () => brandSchema.parse((await api.get('/api/business/brand')).data),
    enabled: !!activeBusinessId,
  });
  const [draft, setDraft] = useState<string[] | null>(null);
  const save = useMutation({
    mutationFn: async (manualColors: string[]) => {
      await api.post('/api/business/brand', { manualColors });
    },
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['brand', activeBusinessId] });
    },
  });

  const b = brand.data;
  if (!b) return null;
  const effective = b.manualColors.length ? b.manualColors : b.colors;
  const source = b.manualColors.length ? 'manual' : b.colorSource;
  const values = draft ?? (b.manualColors.length ? b.manualColors : b.colors.slice(0, 2));
  const v0 = values[0] ?? '';
  const v1 = values[1] ?? '';
  const valid = [v0, v1].filter(Boolean).every((c) => HEX.test(c)) && HEX.test(v0);

  return (
    <View className="gap-3 rounded-card border border-surface-border bg-surface-raised p-4">
      <Text className="font-sans text-sm text-zinc-400">
        Used on generated images for your Google posts. Your own photos are never changed.
      </Text>
      <View className="flex-row items-center gap-3">
        {b.logoUrl ? (
          <Image source={{ uri: b.logoUrl }} style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: '#ffffff' }} contentFit="contain" />
        ) : null}
        <Text className="flex-1 font-sans text-xs text-zinc-500">
          {b.logoUrl
            ? `Logo ${b.logoSource === 'customer_upload' ? 'from your Photos' : 'from your website'}`
            : 'No logo yet — add one in Photos (Logo) to place it on generated images.'}
        </Text>
      </View>
      <View className="flex-row items-center gap-2">
        {effective.map((c) => (
          <View key={c} style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: c, borderWidth: 1, borderColor: '#00000022' }} />
        ))}
        {!!source && <Text className="font-sans text-xs text-zinc-500">Current colours: {SOURCE_LABEL[source] ?? source}</Text>}
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field value={v0} onChangeText={(x) => setDraft([x.trim(), v1])} placeholder="#1a73e8" autoCapitalize="none" />
        </View>
        <View className="flex-1">
          <Field value={v1} onChangeText={(x) => setDraft([v0, x.trim()])} placeholder="#f2a900 (optional)" autoCapitalize="none" />
        </View>
      </View>
      {save.isError && <ErrorText>{getApiErrorMessage(save.error, 'Could not save colours.')}</ErrorText>}
      <PrimaryButton
        title="Save colours"
        loading={save.isPending}
        disabled={!valid}
        onPress={() => save.mutate([v0, v1].filter(Boolean).map((c) => c.toLowerCase()))}
      />
      {b.manualColors.length > 0 && (
        <Pressable onPress={() => save.mutate([])} hitSlop={8}>
          <Text className="text-center font-sans-semibold text-sm text-zinc-400">Use automatic colours</Text>
        </Pressable>
      )}
    </View>
  );
}
