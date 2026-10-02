import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  deleteGbpMedia,
  fetchGbpMedia,
  GbpNotConnectedError,
  publishGbpMedia,
  scheduleGbpMedia,
  uploadGbpMedia,
  type GbpMediaCategory,
  type GbpMediaItem,
} from '@/api/endpoints/gbp';
import { useBusiness } from '@/business/BusinessContext';
import { useDateTimePicker } from '@/components/datetime-picker';
import { EmptyState, LoadingScreen, Screen, Skeleton, useConfirmSheet, useInfoSheet } from '@/components/ui';
import { geotagLine } from '@/api/endpoints/content';
import { formatDateTime } from '@/lib/format';
import {
  pickPhotoFromLibrary,
  pickVideoFromLibrary,
  recordVideoWithCamera,
  takePhotoWithCamera,
  videoProblem,
  type PickedPhoto,
  type PickedVideo,
} from '@/lib/photoLocation';
import { useTheme } from '@/lib/theme';

const CATEGORY_LABEL: Record<GbpMediaCategory, string> = {
  LOGO: 'Logo',
  COVER: 'Cover photo',
  PROFILE: 'Profile',
  ADDITIONAL: 'Photo',
};

const isVideo = (m: GbpMediaItem) => m.mediaType === 'video';
/** "Video" for videos; the photo's category otherwise. */
const itemLabel = (m: GbpMediaItem) => (isVideo(m) ? 'Video' : CATEGORY_LABEL[m.category]);

type FilterTag = 'ALL' | GbpMediaCategory | 'VIDEO';
const FILTERS: { tag: FilterTag; label: string }[] = [
  { tag: 'ALL', label: '#All' },
  { tag: 'LOGO', label: '#Logo' },
  { tag: 'COVER', label: '#Cover' },
  { tag: 'ADDITIONAL', label: '#Photos' },
  { tag: 'VIDEO', label: '#Videos' },
  { tag: 'PROFILE', label: '#Profile' },
];

function StatusDot({ item }: { item: GbpMediaItem }) {
  const t = useTheme();
  if (item.status === 'published') return null;
  return (
    <View
      className="absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5"
      style={{ backgroundColor: item.status === 'failed' ? 'rgba(147,0,10,0.9)' : 'rgba(0,0,0,0.65)' }}
    >
      <Text className="font-sans-bold text-[9px] text-white">
        {item.status === 'failed' ? 'Failed' : item.scheduledFor ? 'Scheduled' : 'Staged'}
      </Text>
    </View>
  );
}

/** Full-size preview — image, category, status, and every CRUD action for this one photo. */
function PreviewModal({ item, onClose }: { item: GbpMediaItem; onClose: () => void }) {
  const t = useTheme();
  const queryClient = useQueryClient();
  const picker = useDateTimePicker();
  const { activeBusinessId } = useBusiness();
  const info = useInfoSheet();
  const confirmSheet = useConfirmSheet();

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['gbp-media', activeBusinessId] });

  const publish = useMutation({
    mutationFn: () => publishGbpMedia(item._id),
    onSuccess: ({ liveWriteApplied }) => {
      invalidate();
      if (!liveWriteApplied) info.show('Still staged', `Live GBP publishing is currently disabled — this ${isVideo(item) ? 'video' : 'photo'} will publish automatically once it's enabled.`);
      else onClose();
    },
    onError: (err) => info.show('Publish failed', getApiErrorMessage(err, 'Please try again.')),
  });

  const schedule = useMutation({
    mutationFn: (date: Date | null) => scheduleGbpMedia(item._id, date),
    onSuccess: invalidate,
    onError: (err) => info.show('Could not schedule', getApiErrorMessage(err, 'Please try again.')),
  });

  const remove = useMutation({
    mutationFn: () => deleteGbpMedia(item._id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => info.show('Delete failed', getApiErrorMessage(err, 'Please try again.')),
  });

  const confirmDelete = () => {
    const kind = isVideo(item) ? 'video' : 'photo';
    const msg =
      item.status === 'published'
        ? `This ${kind} is live on Google. Remove it from your profile?`
        : `This removes the staged ${kind} permanently.`;
    confirmSheet.confirm({
      title: `Delete ${kind}?`,
      message: msg,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => remove.mutate(),
    });
  };

  const isStaged = item.status === 'staged';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)' }}>
        <View className="flex-row items-center justify-between px-4 pt-14">
          <Text className="font-sans-bold text-sm text-white">{itemLabel(item)}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={26} color="#ffffff" />
          </Pressable>
        </View>
        <View className="flex-1 items-center justify-center px-4">
          {isVideo(item) ? (
            <Pressable
              onPress={() => void Linking.openURL(item.url)}
              // No `className` — see note above.
              style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 16, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Ionicons name="play-circle" size={64} color="#ffffff" />
              <Text className="font-sans-semibold text-sm text-white">Play video</Text>
            </Pressable>
          ) : (
            <Image source={{ uri: item.url }} style={{ width: '100%', aspectRatio: 1 }} contentFit="contain" />
          )}
        </View>
        {item.failureReason && (
          <Text className="px-5 pb-2 text-center font-sans text-xs text-rose-300">{item.failureReason}</Text>
        )}
        {!!geotagLine(item.geotag) && (
          <Text className="px-5 pb-2 text-center font-sans text-xs text-zinc-400">{geotagLine(item.geotag)}</Text>
        )}
        {item.scheduledFor && isStaged && (
          <Text className="px-5 pb-2 text-center font-sans text-xs text-zinc-400">
            Scheduled to publish on {formatDateTime(item.scheduledFor)}
          </Text>
        )}
        <View className="gap-2.5 px-5 pb-10 pt-2">
          {isStaged && (
            <Pressable
              onPress={() => publish.mutate()}
              disabled={publish.isPending}
              // No `className` — react-native-css-interop can swallow onPress
              // on styled Pressables (see components/ui.tsx).
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: t.brand, paddingVertical: 14, opacity: publish.isPending ? 0.6 : 1 }}
            >
              <Ionicons name="cloud-upload-outline" size={17} color="#ffffff" />
              <Text className="font-sans-bold text-base text-on-brand">
                {publish.isPending ? 'Publishing…' : 'Publish Now'}
              </Text>
            </Pressable>
          )}
          {isStaged && (
            <Pressable
              onPress={() =>
                item.scheduledFor
                  ? schedule.mutate(null)
                  : picker.open(new Date(Date.now() + 24 * 60 * 60 * 1000), (date) => schedule.mutate(date))
              }
              disabled={schedule.isPending}
              // No `className` — see note above.
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, borderWidth: 1, borderColor: t.border, paddingVertical: 14 }}
            >
              <Ionicons name="calendar-outline" size={17} color={t.text} />
              <Text className="font-sans-bold text-base text-white">
                {item.scheduledFor ? 'Cancel Schedule' : 'Schedule for Later'}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={confirmDelete}
            disabled={remove.isPending}
            // No `className` — see note above.
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,99,99,0.4)', paddingVertical: 14 }}
          >
            <Ionicons name="trash-outline" size={17} color="#ff6b6b" />
            <Text className="font-sans-bold text-base" style={{ color: '#ff6b6b' }}>
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </Text>
          </Pressable>
        </View>
      </View>
      {picker.element}
      {info.node}
      {confirmSheet.node}
    </Modal>
  );
}

/**
 * "View All" — every photo, filterable by category (hashtag-style pills),
 * with preview/publish/schedule/delete per photo.
 */
export default function AllPhotosScreen() {
  const router = useRouter();
  const t = useTheme();
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTag>('ALL');
  const [preview, setPreview] = useState<GbpMediaItem | null>(null);
  const info = useInfoSheet();

  const media = useQuery({
    queryKey: ['gbp-media', activeBusinessId],
    queryFn: fetchGbpMedia,
    enabled: !!activeBusinessId,
    retry: false,
  });

  const upload = useMutation({
    mutationFn: uploadGbpMedia,
    onSuccess: (asset) => {
      void queryClient.invalidateQueries({ queryKey: ['gbp-media', activeBusinessId] });
      const geo = geotagLine(asset.geotag);
      const kind = asset.mediaType === 'video' ? 'video' : 'photo';
      info.show(kind === 'video' ? 'Video saved' : 'Photo saved', `It's staged — publish or schedule it from the ${kind}'s preview.${geo ? `\n${geo}.` : ''}`);
    },
    onError: (err) => info.show('Upload failed', getApiErrorMessage(err, 'Please try again.')),
  });

  const startUpload = async (category: GbpMediaCategory, from: 'library' | 'camera' = 'library') => {
    let picked: PickedPhoto | null;
    try {
      picked = from === 'camera' ? await takePhotoWithCamera() : await pickPhotoFromLibrary();
    } catch {
      info.show(
        'Permission needed',
        from === 'camera' ? 'Allow camera access to take a photo for your profile.' : 'Allow photo library access to add business media.'
      );
      return;
    }
    if (!picked) return;
    upload.mutate({ uri: picked.uri, mimeType: picked.mimeType, fileName: picked.fileName, category, location: picked.location });
  };

  /** Video: gallery pick or in-app recording; location handled exactly like photos (lib/photoLocation.ts). */
  const startVideoUpload = async (from: 'library' | 'camera') => {
    let picked: PickedVideo | null;
    try {
      picked = from === 'camera' ? await recordVideoWithCamera() : await pickVideoFromLibrary();
    } catch {
      info.show(
        'Permission needed',
        from === 'camera' ? 'Allow camera and microphone access to record a video for your profile.' : 'Allow photo and video library access to add business media.'
      );
      return;
    }
    if (!picked) return;
    const problem = videoProblem(picked);
    if (problem) {
      info.show('Video not uploaded', problem);
      return;
    }
    upload.mutate({ uri: picked.uri, mimeType: picked.mimeType, fileName: picked.fileName, category: 'ADDITIONAL', location: picked.location });
  };

  // Logo/Cover are set from their own dedicated slots on the Photos summary
  // screen (business-assets.tsx) now, so this gallery's "+" only ever adds
  // an additional photo — no more "what kind of photo is this?" prompt.
  const handleAdd = () => void startUpload('ADDITIONAL');
  // Taken in the app: the phone's position at capture becomes the photo's location.
  const handleCamera = () => void startUpload('ADDITIONAL', 'camera');

  if (media.isLoading) return <LoadingScreen />;

  const notConnected = media.error instanceof GbpNotConnectedError;
  const items = (media.data?.media ?? []).filter((m) =>
    filter === 'ALL' ? true
      : filter === 'VIDEO' ? isVideo(m)
      : filter === 'ADDITIONAL' ? m.category === 'ADDITIONAL' && !isVideo(m)
      : m.category === filter);

  return (
    <Screen>
      <View className="flex-row items-center justify-between px-4 pb-3 pt-4">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={t.text} />
        </Pressable>
        <Text className="font-display-bold text-lg text-white">Photos & Videos</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable onPress={handleCamera} disabled={notConnected || upload.isPending} hitSlop={10} accessibilityLabel="Take a photo">
            <Ionicons name="camera-outline" size={25} color={notConnected ? t.textFaint : t.brandBright} />
          </Pressable>
          <Pressable onPress={handleAdd} disabled={notConnected || upload.isPending} hitSlop={10} accessibilityLabel="Add from gallery">
            <Ionicons name="add-circle-outline" size={26} color={notConnected ? t.textFaint : t.brandBright} />
          </Pressable>
        </View>
      </View>


      {/* Upload — photos and videos, both from the camera or the gallery. */}
      {!notConnected && (
        <View className="flex-row gap-2.5 px-4 pb-3">
          {([
            { key: 'photo', title: 'Upload Photo', icon: 'image-outline', camera: { label: 'Take photo', icon: 'camera-outline', run: handleCamera }, gallery: { label: 'Choose photo', icon: 'images-outline', run: handleAdd } },
            { key: 'video', title: 'Upload Video', icon: 'videocam-outline', camera: { label: 'Record video', icon: 'videocam-outline', run: () => void startVideoUpload('camera') }, gallery: { label: 'Choose video', icon: 'film-outline', run: () => void startVideoUpload('library') } },
          ] as const).map((group) => (
            <View key={group.key} className="flex-1 rounded-card border border-surface-border bg-surface-raised p-2.5">
              <View className="mb-2 flex-row items-center gap-1.5">
                <Ionicons name={group.icon} size={15} color={t.brandBright} />
                <Text className="font-sans-bold text-xs text-white">{group.title}</Text>
              </View>
              {[group.camera, group.gallery].map((a) => (
                <Pressable
                  key={a.label}
                  onPress={a.run}
                  disabled={upload.isPending}
                  accessibilityLabel={a.label}
                  // No `className` — see note above.
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1, borderColor: t.border, paddingHorizontal: 10, paddingVertical: 7, marginTop: 6, opacity: upload.isPending ? 0.5 : 1 }}
                >
                  <Ionicons name={a.icon} size={14} color={t.brandBright} />
                  <Text className="font-sans-semibold text-xs text-zinc-200">{a.label}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      )}
      {upload.isPending && (
        <Text className="px-4 pb-2 font-sans text-xs text-zinc-400">Uploading… videos can take a minute on mobile data.</Text>
      )}

      {notConnected ? (
        <View className="px-4 pt-10">
          <EmptyState title="Google Business Profile not connected" hint={media.error?.message} />
        </View>
      ) : (
        <>
          {media.data?.liveSyncError && (
            <View
              className="mx-4 mb-3 flex-row items-start gap-2.5 rounded-card px-4 py-3"
              style={{ backgroundColor: `${t.amber}1a`, borderWidth: 1, borderColor: `${t.amber}40` }}
            >
              <Ionicons name="warning-outline" size={16} color={t.amber} style={{ marginTop: 1 }} />
              <Text className="flex-1 font-sans text-xs leading-4" style={{ color: t.amber }}>
                Couldn't refresh from Google — showing saved photos only. {media.data.liveSyncError}
              </Text>
            </View>
          )}

          {/* flexGrow: 0 — a bare ScrollView defaults to flexGrow: 1, and as
              a direct flex-column sibling of the grid ScrollView below (no
              wrapping View wrapping either), both were stretching to fill
              the remaining screen height: this row of pills ballooned into
              tall columns, and the grid gained a large empty gap under the
              actual photos. Pinning this one to its content height fixes
              both at once. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerClassName="gap-2 px-4 pb-3"
          >
            {FILTERS.map((f) => {
              const active = filter === f.tag;
              return (
                <Pressable
                  key={f.tag}
                  onPress={() => setFilter(f.tag)}
                  // No `className` — see note above.
                  style={{
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: active ? t.brandBright : t.border,
                    backgroundColor: active ? `${t.brandBright}1a` : 'transparent',
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                  }}
                >
                  <Text className="font-sans-bold text-sm" style={{ color: active ? t.brandBright : t.textFaint }}>
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView
            contentContainerClassName="px-4 pb-10"
            refreshControl={
              <RefreshControl refreshing={media.isFetching} onRefresh={() => void media.refetch()} tintColor={t.brandBright} />
            }
          >
            {media.isError ? (
              <EmptyState title="Couldn't load your photos" hint={getApiErrorMessage(media.error, 'Pull down to retry.')} />
            ) : items.length === 0 ? (
              <View className="items-center rounded-card border border-surface-border bg-surface-raised px-6 py-10">
                <Ionicons name="image-outline" size={30} color={t.violet} />
                <Text className="mt-3 font-sans-semibold text-base text-zinc-300">
                  {filter === 'VIDEO' ? 'No videos yet' : 'No photos in this category yet'}
                </Text>
              </View>
            ) : (
              <View className="flex-row flex-wrap gap-2.5">
                {items.map((item) => (
                  <Pressable
                    key={item._id}
                    onPress={() => setPreview(item)}
                    // No `className` — see note above.
                    style={{ width: 108, height: 108, borderRadius: 16, overflow: 'hidden' }}
                  >
                    {isVideo(item) ? (
                      <View style={{ flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="play-circle" size={36} color="#ffffff" />
                      </View>
                    ) : (
                      <Image source={{ uri: item.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                    )}
                    <StatusDot item={item} />
                    <View className="absolute bottom-0 left-0 right-0 flex-row items-center gap-1 bg-black/50 px-1.5 py-1">
                      {isVideo(item) && <Ionicons name="videocam" size={10} color="#ffffff" />}
                      <Text className="font-sans-bold text-[10px] text-white" numberOfLines={1}>
                        {itemLabel(item)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
        </>
      )}

      {preview && <PreviewModal item={preview} onClose={() => setPreview(null)} />}
      {info.node}
    </Screen>
  );
}
