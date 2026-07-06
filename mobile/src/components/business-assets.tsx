import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';

import { fetchBuffer } from '@/api/endpoints/scheduler';
import { useBusiness } from '@/business/BusinessContext';
import { Chip } from '@/components/ui';
import { BRAND_GRADIENT, useTheme } from '@/lib/theme';

const GUIDELINES_URL = 'https://support.google.com/business/answer/6103862';

const SMART_TIPS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'sparkles-outline', text: 'Upload high-quality, clear photos that truly represent your services.' },
  { icon: 'calendar-outline', text: 'Regularly upload new Photos/Videos to engage customers and keep your profile up-to-date.' },
  { icon: 'heart-outline', text: 'Encourage your customers to upload photos of their experiences.' },
];

/**
 * "Business Assets — GBP Photos" body, shared by the Photos tab and the
 * Photos sub-tab inside GBP. Counts come from the scheduler buffer (posts
 * that carry media are what actually lands on the profile); direct media
 * upload from mobile is not wired yet, so Add explains the web path.
 */
export function BusinessAssets() {
  const { activeBusinessId } = useBusiness();
  const t = useTheme();
  const [bucket, setBucket] = useState<'soon' | 'published'>('soon');

  const buffer = useQuery({
    queryKey: ['scheduler-buffer', activeBusinessId],
    queryFn: fetchBuffer,
    enabled: !!activeBusinessId,
  });

  const publishedCount = (buffer.data?.allPosts ?? []).filter(
    (p) => p.status === 'published'
  ).length;
  const soonCount = buffer.data?.totalScheduledPosts ?? 0;

  const handleAddMedia = () => {
    Alert.alert(
      'Add Business Media',
      'Direct photo upload from the app is coming soon. For now, add photos from the web dashboard — they are published to your Google Business Profile automatically.'
    );
  };

  return (
    <View className="px-4">
      {/* Bucket chips */}
      <View className="mb-4 flex-row gap-2">
        <Chip
          label={`Publishing Soon  ${soonCount}`}
          selected={bucket === 'soon'}
          onPress={() => setBucket('soon')}
        />
        <Chip
          label={`Published  ${publishedCount}`}
          selected={bucket === 'published'}
          onPress={() => setBucket('published')}
        />
      </View>

      {/* Assets area — media upload not wired on mobile yet, so this is the
          empty state + CTA regardless of bucket. */}
      <View className="items-center rounded-3xl border border-surface-border bg-surface-raised px-6 py-10">
        <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-surface-overlay">
          <Ionicons name="image-outline" size={30} color={t.violet} />
        </View>
        <Text className="mb-5 text-base font-semibold text-zinc-300">No Assets Added</Text>
        <Pressable onPress={handleAddMedia} className="overflow-hidden rounded-2xl active:opacity-85">
          <LinearGradient
            colors={[...BRAND_GRADIENT]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 13 }}
          >
            <Ionicons name="add" size={18} color="#ffffff" />
            <Text className="text-base font-bold text-on-brand">Add your Business Media</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Smart tips */}
      <View className="mb-2 mt-6 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Text className="text-base">💡</Text>
          <Text className="text-base font-bold" style={{ color: t.cyan }}>
            Smart Tips
          </Text>
        </View>
        <Pressable onPress={() => void Linking.openURL(GUIDELINES_URL)} className="active:opacity-70">
          <Text className="text-sm font-semibold underline" style={{ color: t.brandBright }}>
            View Guidelines
          </Text>
        </Pressable>
      </View>
      <View className="gap-2.5 pb-8">
        {SMART_TIPS.map((tip) => (
          <View
            key={tip.text}
            className="flex-row items-center gap-3 rounded-2xl border border-surface-border bg-surface-raised px-4 py-3.5"
          >
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-surface-overlay">
              <Ionicons name={tip.icon} size={19} color={t.brandBright} />
            </View>
            <Text className="flex-1 text-sm leading-5 text-zinc-300">{tip.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
