import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  fetchGbpMedia,
  GbpNotConnectedError,
  uploadGbpMedia,
  type GbpMediaCategory,
  type GbpMediaItem,
} from '@/api/endpoints/gbp';
import { useBusiness } from '@/business/BusinessContext';
import { EmptyState, InfoSheet, Skeleton, useInfoSheet } from '@/components/ui';
import { promptConnectGoogle } from '@/lib/connectGoogle';
import { formatDateTime } from '@/lib/format';
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

/** "19 days ago" — full-word form, matching the reference app's copy (our
 *  shared timeAgo() abbreviates to "19d", which read too clipped here). */
function daysAgo(iso?: string): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function WhyPublishInfo({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Text className="font-sans-bold text-sm underline text-center" style={{ color: '#6ea8fe' }}>
        Why Publish Photos &amp; Videos?
      </Text>
    </Pressable>
  );
}

/**
 * Logo / Cover photo — singleton slot matching the website's GbpMediaManager
 * (renderSingletonSlot): shows the CURRENT live image before you replace it,
 * not a blind "pick a category" prompt. A pending (staged/failed) upload is
 * flagged but not re-actioned here — publishing/discarding it stays in View
 * All's full preview (this screen is deliberately summary-only, see the
 * BusinessAssets doc comment below).
 */
function MediaSlot({
  label,
  hint,
  aspectRatio,
  live,
  pending,
  uploading,
  onUpload,
}: {
  label: string;
  hint: string;
  aspectRatio: number;
  live: GbpMediaItem | undefined;
  pending: GbpMediaItem | undefined;
  uploading: boolean;
  onUpload: () => void;
}) {
  const t = useTheme();
  return (
    <View className="flex-1 rounded-card border border-surface-border bg-surface-raised p-3.5">
      <Text className="font-sans-bold text-sm text-white">{label}</Text>
      <Text className="mt-0.5 font-sans text-xs leading-4 text-zinc-500">{hint}</Text>

      <View
        className="mt-3 overflow-hidden rounded-xl bg-surface-overlay"
        style={{ aspectRatio, width: '100%' }}
      >
        {live ? (
          <Image source={{ uri: live.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Ionicons name="image-outline" size={22} color={t.textFaint} />
          </View>
        )}
      </View>

      {pending && (
        <View className="mt-2 flex-row items-center gap-1.5 self-start rounded-full bg-surface-overlay px-2.5 py-1">
          <Ionicons name="time-outline" size={11} color={t.amber} />
          <Text className="font-sans-bold text-[10px]" style={{ color: t.amber }}>
            {pending.status === 'failed' ? 'Replacement failed — see View All' : 'Replacement pending — see View All'}
          </Text>
        </View>
      )}

      <Pressable
        onPress={onUpload}
        disabled={uploading}
        // No `className` — react-native-css-interop can swallow onPress on
        // styled Pressables (see components/ui.tsx PrimaryButton).
        style={{
          marginTop: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: t.border,
          paddingVertical: 9,
          opacity: uploading ? 0.6 : 1,
        }}
      >
        <Ionicons name="camera-outline" size={14} color={t.text} />
        <Text className="font-sans-bold text-xs" style={{ color: t.text }}>
          {uploading ? 'Uploading…' : live ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Photos tab main screen — summary view (recent published strip, scheduled
 * timeline) with a "View All" link into the full filterable gallery
 * (photos/all.tsx). Previously this screen dumped every photo into one grid
 * inline; that full grid + category filtering now lives in photos/all.tsx.
 */
export function BusinessAssets() {
  const { activeBusinessId } = useBusiness();
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [whyInfoVisible, setWhyInfoVisible] = useState(false);
  // Tracks which slot's upload is in flight — `upload.isPending` alone can't
  // tell the Logo card from the Cover card from the gallery button.
  const [uploadingCategory, setUploadingCategory] = useState<GbpMediaCategory | null>(null);
  const info = useInfoSheet();

  const media = useQuery({
    queryKey: ['gbp-media', activeBusinessId],
    queryFn: fetchGbpMedia,
    enabled: !!activeBusinessId,
    retry: false,
  });

  const upload = useMutation({
    mutationFn: uploadGbpMedia,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gbp-media', activeBusinessId] });
      info.show('Photo saved', "It's staged — publish or schedule it from View All.");
    },
    onError: (error) => info.show('Upload failed', getApiErrorMessage(error, 'Please try again.')),
    onSettled: () => setUploadingCategory(null),
  });

  const notConnected = media.error instanceof GbpNotConnectedError;

  /**
   * Category is now fixed by whichever entry point was tapped (the Logo
   * slot, the Cover slot, or the gallery's Add button) — no more "what kind
   * of photo is this?" prompt in between. Matches the website's
   * GbpMediaManager, which has the same three fixed upload entry points.
   */
  const pickAndUpload = async (category: GbpMediaCategory) => {
    if (notConnected) {
      promptConnectGoogle(media.error?.message ?? 'Connect your Google Business Profile to add photos.');
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      info.show('Permission needed', 'Allow photo library access to add business media.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.85 });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setUploadingCategory(category);
    upload.mutate({
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      fileName: asset.fileName ?? `photo-${Date.now()}.jpg`,
      category,
    });
  };

  if (media.isLoading) {
    return (
      <View className="px-4">
        <Skeleton className="mb-4 h-24 rounded-card" />
        <View className="mb-4 flex-row gap-3">
          <Skeleton className="h-40 flex-1 rounded-card" />
          <Skeleton className="h-40 flex-1 rounded-card" />
        </View>
        <View className="flex-row gap-2.5">
          <Skeleton className="h-28 w-28" />
          <Skeleton className="h-28 w-28" />
          <Skeleton className="h-28 w-28" />
        </View>
      </View>
    );
  }

  if (notConnected) {
    return (
      <View className="px-4">
        <EmptyState
          title="Google Business Profile not connected"
          hint={media.error?.message}
          action={
            <Pressable
              onPress={() => promptConnectGoogle(media.error?.message ?? 'Connect your Google Business Profile to add photos.')}
              // No `className` — react-native-css-interop can swallow onPress
              // on styled Pressables (see components/ui.tsx).
              style={{ marginTop: 12, borderRadius: 999, backgroundColor: t.brand, paddingHorizontal: 20, paddingVertical: 10 }}
            >
              <Text className="font-sans-bold text-sm text-on-brand">Connect Google</Text>
            </Pressable>
          }
        />
      </View>
    );
  }

  const all: GbpMediaItem[] = media.data?.media ?? [];
  const published = all
    .filter((m) => m.status === 'published')
    .sort((a, b) => new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime());
  const recentPublished = published.slice(0, 8);
  const scheduled = all
    .filter((m) => m.status === 'staged' && m.scheduledFor)
    .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime());

  // Logo/Cover are singleton slots — same "current live image + one pending
  // replacement" model as the website's GbpMediaManager.
  const findSlot = (category: GbpMediaCategory, statuses: GbpMediaItem['status'][]) =>
    all.find((m) => m.category === category && statuses.includes(m.status));
  const logoLive = findSlot('LOGO', ['published']);
  const logoPending = findSlot('LOGO', ['staged', 'failed']);
  const coverLive = findSlot('COVER', ['published']);
  const coverPending = findSlot('COVER', ['staged', 'failed']);

  return (
    <View className="px-4">
      {/* Previously this failure was swallowed server-side with only a
          console.warn — nothing ever told you *why* the photo list wasn't
          changing. Now the API reports it and we show it. */}
      {media.data?.liveSyncError && (
        <View
          className="mb-4 flex-row items-start gap-2.5 rounded-card px-4 py-3"
          style={{ backgroundColor: `${t.amber}1a`, borderWidth: 1, borderColor: `${t.amber}40` }}
        >
          <Ionicons name="warning-outline" size={16} color={t.amber} style={{ marginTop: 1 }} />
          <Text className="flex-1 font-sans text-xs leading-4" style={{ color: t.amber }}>
            Couldn't refresh from Google — showing saved photos only. {media.data.liveSyncError}
          </Text>
        </View>
      )}

      {/* Honest version of the reference app's banner — no "published by AI"
          claim (nothing here auto-publishes without the owner's own
          schedule or button tap; see logProfileActivity.ts). */}
      <View
        className="mb-6 flex-row items-center gap-4 overflow-hidden rounded-card p-5"
        style={{ backgroundColor: t.card, borderWidth: 1, borderColor: t.border }}
      >
        <View className="flex-1">
          <Text className="font-display-bold text-lg text-white">Keep your profile active</Text>
          <Text className="mt-1 font-sans text-sm leading-5 text-zinc-400">
            Regularly publishing fresh photos helps you rank higher and show up more on Google.
          </Text>
        </View>
        <View className="h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: `${t.brandBright}26` }}>
          <Ionicons name="storefront" size={26} color={t.brandBright} />
        </View>
      </View>

      {/* Logo / Cover — dedicated slots showing what's currently live,
          matching the website's GbpMediaManager instead of a blind "what
          kind of photo is this?" prompt. */}
      <View className="mb-6 flex-row gap-3">
        <MediaSlot
          label="Logo"
          hint="Square, your brand mark"
          aspectRatio={1}
          live={logoLive}
          pending={logoPending}
          uploading={uploadingCategory === 'LOGO'}
          onUpload={() => void pickAndUpload('LOGO')}
        />
        <MediaSlot
          label="Cover photo"
          hint="Wide, landscape banner"
          aspectRatio={16 / 9}
          live={coverLive}
          pending={coverPending}
          uploading={uploadingCategory === 'COVER'}
          onUpload={() => void pickAndUpload('COVER')}
        />
      </View>

      <View className="mb-1 flex-row items-center justify-between">
        <Text className="font-display-bold text-lg text-white">Your Photos &amp; Videos</Text>
        <Pressable onPress={() => router.push('/photos/all' as never)} hitSlop={10}>
          <View className="flex-row items-center gap-1">
            <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>View All</Text>
            <Ionicons name="chevron-forward" size={14} color={t.brandBright} />
          </View>
        </Pressable>
      </View>
      <Text className="mb-3 font-sans text-sm text-zinc-500">{published.length} published</Text>

      {recentPublished.length === 0 ? (
        <View className="mb-4 items-center rounded-card border border-surface-border bg-surface-raised px-6 py-10">
          <View className="mb-3 h-16 w-16 items-center justify-center rounded-2xl bg-surface-overlay">
            <Ionicons name="image-outline" size={30} color={t.violet} />
          </View>
          <Text className="font-sans-semibold text-base text-zinc-300">No photos published yet</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2.5 pb-1">
          {recentPublished.map((item) => (
            <Pressable
              key={item._id}
              onPress={() => router.push('/photos/all' as never)}
              // No `className` — see note above.
              style={{ width: 132, height: 132, borderRadius: 16, overflow: 'hidden' }}
            >
              <Image source={{ uri: item.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              <View className="absolute bottom-1.5 left-1.5 flex-row items-center gap-1 rounded-full bg-black/60 px-2 py-1">
                <Ionicons name="location" size={10} color="#ffffff" />
                <Text className="font-sans-bold text-[10px] text-white">{daysAgo(item.publishedAt)}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Fixed to ADDITIONAL now that Logo/Cover have their own slots above
          — this button only ever adds to the gallery, matching the
          website's separate "Add photo" button for the gallery section. */}
      {!notConnected && (
        <Pressable
          onPress={() => void pickAndUpload('ADDITIONAL')}
          disabled={uploadingCategory === 'ADDITIONAL'}
          // No `className` — see note above.
          style={{ marginTop: 16, borderRadius: 16, overflow: 'hidden' }}
        >
          <LinearGradient
            colors={[...BRAND_GRADIENT]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ alignItems: 'center', paddingVertical: 16 }}
          >
            <Text className="font-sans-bold text-base text-on-brand">
              {uploadingCategory === 'ADDITIONAL' ? 'Uploading…' : 'Add Gallery Photo'}
            </Text>
          </LinearGradient>
        </Pressable>
      )}

      <View className="mt-4 items-center">
        <WhyPublishInfo onPress={() => setWhyInfoVisible(true)} />
      </View>
      <InfoSheet
        visible={whyInfoVisible}
        onClose={() => setWhyInfoVisible(false)}
        title="Why publish photos & videos?"
        message="Profiles with regular new photos are shown more often in local search and get more calls, direction requests, and website clicks — Google treats fresh media as a signal that a business is active. Aim for a few new photos every week."
      />
      {info.node}

      {/* Scheduled Photos — real, from GbpMediaAsset.scheduledFor (see
          gbpMediaService.scheduleAsset + publishScheduledMediaCron). */}
      <View className="mt-8">
        <Text className="mb-3 font-display-bold text-lg text-white">Scheduled Photos</Text>
        {scheduled.length === 0 ? (
          <View className="items-center rounded-card border border-surface-border bg-surface-raised px-6 py-8">
            <Text className="font-sans-semibold text-base text-zinc-300">No Photos or Videos Scheduled</Text>
            <Text className="mt-1.5 text-center font-sans text-sm leading-5 text-zinc-500">
              Regular photos/videos keeps your Google Profile fresh and active.
            </Text>
          </View>
        ) : (
          <View>
            {scheduled.map((item, i) => (
              <View key={item._id} className="flex-row gap-3">
                <View className="items-center">
                  <View className="mt-1.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.brandBright }} />
                  {i < scheduled.length - 1 && <View className="w-px flex-1" style={{ backgroundColor: t.border }} />}
                </View>
                <View className="mb-4 flex-1 flex-row items-center gap-3 rounded-card border border-surface-border bg-surface-raised p-3">
                  <View className="h-14 w-14 overflow-hidden rounded-xl bg-surface-overlay">
                    <Image source={{ uri: item.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  </View>
                  <View className="flex-1">
                    <Text className="font-sans-semibold text-sm text-white">{CATEGORY_LABEL[item.category]}</Text>
                    <Text className="mt-0.5 font-sans text-xs text-zinc-500">{formatDateTime(item.scheduledFor)}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Smart tips */}
      <View className="mb-2 mt-6 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Text className="text-base">💡</Text>
          <Text className="font-display-bold text-base" style={{ color: t.cyan }}>
            Smart Tips
          </Text>
        </View>
        <Pressable onPress={() => void Linking.openURL(GUIDELINES_URL)}>
          <Text className="font-sans-semibold text-sm underline" style={{ color: t.brandBright }}>
            View Guidelines
          </Text>
        </Pressable>
      </View>
      <View className="gap-2.5 pb-8">
        {SMART_TIPS.map((tip) => (
          <View
            key={tip.text}
            className="flex-row items-center gap-3 rounded-card border border-surface-border bg-surface-raised px-4 py-3.5"
          >
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-surface-overlay">
              <Ionicons name={tip.icon} size={19} color={t.brandBright} />
            </View>
            <Text className="flex-1 font-sans text-sm leading-5 text-zinc-300">{tip.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
