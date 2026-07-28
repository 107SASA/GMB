import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Alert, Linking, Pressable, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  fetchGbpMedia,
  GbpNotConnectedError,
  uploadGbpMedia,
  type GbpMediaCategory,
} from '@/api/endpoints/gbp';
import { useBusiness } from '@/business/BusinessContext';
import { EmptyState, Skeleton } from '@/components/ui';
import { promptConnectGoogle } from '@/lib/connectGoogle';
import { BRAND_GRADIENT, useTheme } from '@/lib/theme';

const GUIDELINES_URL = 'https://support.google.com/business/answer/6103862';

const SMART_TIPS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'sparkles-outline', text: 'Upload high-quality, clear photos that truly represent your services.' },
  { icon: 'calendar-outline', text: 'Regularly upload new Photos/Videos to engage customers and keep your profile up-to-date.' },
  { icon: 'heart-outline', text: 'Encourage your customers to upload photos of their experiences.' },
];

const CATEGORY_LABEL: Record<GbpMediaCategory, string> = {
  LOGO: 'Logo',
  COVER: 'Cover photo',
  PROFILE: 'Profile',
  ADDITIONAL: 'Photo',
};

/** Prompts for which slot a picked photo goes into, matching Google's categories. */
function pickCategory(onPick: (category: GbpMediaCategory) => void) {
  Alert.alert('Add to your profile', 'What kind of photo is this?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Logo', onPress: () => onPick('LOGO') },
    { text: 'Cover photo', onPress: () => onPick('COVER') },
    { text: 'Additional photo', onPress: () => onPick('ADDITIONAL') },
  ]);
}

/**
 * "Business Assets — GBP Photos": the live Google Business Profile media
 * library (logo/cover/additional photos), shared by the Photos tab and the
 * Photos sub-tab inside GBP. Reads and writes the real profile via
 * /api/gbp/media{,/upload} — uploads always land in storage; whether they
 * also push live to Google depends on the server's GBP_LIVE_WRITES_ENABLED
 * gate (liveWritesEnabled below).
 */
export function BusinessAssets() {
  const { activeBusinessId } = useBusiness();
  const t = useTheme();
  const queryClient = useQueryClient();

  const media = useQuery({
    queryKey: ['gbp-media', activeBusinessId],
    queryFn: fetchGbpMedia,
    enabled: !!activeBusinessId,
    retry: false,
  });

  const upload = useMutation({
    mutationFn: uploadGbpMedia,
    onSuccess: ({ liveWriteApplied, note }) => {
      void queryClient.invalidateQueries({ queryKey: ['gbp-media', activeBusinessId] });
      if (!liveWriteApplied && note) Alert.alert('Photo saved', note);
    },
    onError: (error) => {
      Alert.alert('Upload failed', getApiErrorMessage(error, 'Please try again.'));
    },
  });

  const notConnected = media.error instanceof GbpNotConnectedError;

  const startUpload = async (category: GbpMediaCategory) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to add business media.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.85,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    upload.mutate({
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      fileName: asset.fileName ?? `photo-${Date.now()}.jpg`,
      category,
    });
  };

  const handleAddMedia = () => {
    if (notConnected) {
      promptConnectGoogle(media.error?.message ?? 'Connect your Google Business Profile to add photos.');
      return;
    }
    pickCategory((category) => void startUpload(category));
  };

  return (
    <View className="px-4">
      {media.isLoading ? (
        <View className="mb-4 flex-row flex-wrap gap-2.5">
          <Skeleton className="h-28 w-28" />
          <Skeleton className="h-28 w-28" />
          <Skeleton className="h-28 w-28" />
        </View>
      ) : notConnected ? (
        <EmptyState
          title="Google Business Profile not connected"
          hint={media.error?.message}
          action={
            <Pressable
              onPress={() =>
                promptConnectGoogle(media.error?.message ?? 'Connect your Google Business Profile to add photos.')
              }
              className="mt-3 rounded-xl bg-brand px-5 py-2.5 active:opacity-80"
            >
              <Text className="text-sm font-semibold text-on-brand">Connect Google</Text>
            </Pressable>
          }
        />
      ) : media.isError ? (
        <EmptyState
          title="Couldn't load your photos"
          hint={getApiErrorMessage(media.error, 'Pull down to retry.')}
        />
      ) : media.data && media.data.media.length > 0 ? (
        <View className="mb-4">
          {!media.data.liveWritesEnabled && (
            <View className="mb-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3.5 py-2.5">
              <Text className="text-xs leading-4 text-amber-300">
                New uploads are saved but won't appear on Google yet — live publishing is temporarily paused.
              </Text>
            </View>
          )}
          <View className="flex-row flex-wrap gap-2.5">
            {media.data.media.map((item) => (
              <View
                key={item.name || item.url}
                className="overflow-hidden rounded-2xl border border-surface-border bg-surface-raised"
              >
                <Image
                  source={{ uri: item.thumbnailUrl || item.url }}
                  style={{ width: 108, height: 108 }}
                  contentFit="cover"
                />
                <View className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-1">
                  <Text className="text-[10px] font-semibold text-white" numberOfLines={1}>
                    {CATEGORY_LABEL[item.category]}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <View className="mb-4 items-center rounded-3xl border border-surface-border bg-surface-raised px-6 py-10">
          <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-surface-overlay">
            <Ionicons name="image-outline" size={30} color={t.violet} />
          </View>
          <Text className="mb-5 text-base font-semibold text-zinc-300">No Assets Added</Text>
        </View>
      )}

      {!notConnected && (
        <Pressable
          onPress={handleAddMedia}
          disabled={upload.isPending}
          className="mb-2 self-start overflow-hidden rounded-2xl active:opacity-85"
        >
          <LinearGradient
            colors={[...BRAND_GRADIENT]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 13 }}
          >
            <Ionicons name="add" size={18} color="#ffffff" />
            <Text className="text-base font-bold text-on-brand">
              {upload.isPending ? 'Uploading…' : 'Add your Business Media'}
            </Text>
          </LinearGradient>
        </Pressable>
      )}

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
