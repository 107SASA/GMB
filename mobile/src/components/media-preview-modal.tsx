import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/api/client';
import { geotagLine } from '@/api/endpoints/content';
import {
  deleteGbpMedia,
  publishGbpMedia,
  scheduleGbpMedia,
  type GbpMediaCategory,
  type GbpMediaItem,
} from '@/api/endpoints/gbp';
import { useBusiness } from '@/business/BusinessContext';
import { useDateTimePicker } from '@/components/datetime-picker';
import { useConfirmSheet, useInfoSheet } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/**
 * One photo / video: full-size preview plus Publish Now, Schedule for Later
 * and Delete. Opened from View All (photos/all.tsx) on tap, and straight
 * after an upload from the Posts tab or View All, so the owner publishes
 * the new item right away instead of hunting for it in View All.
 */

export const CATEGORY_LABEL: Record<GbpMediaCategory, string> = {
  LOGO: 'Logo',
  COVER: 'Cover photo',
  PROFILE: 'Profile',
  ADDITIONAL: 'Photo',
};

export const isVideo = (m: GbpMediaItem) => m.mediaType === 'video';
/** "Video" for videos; the photo's category otherwise. */
export const itemLabel = (m: GbpMediaItem) => (isVideo(m) ? 'Video' : CATEGORY_LABEL[m.category]);

/** Full-size preview — image, category, status, and every CRUD action for this one photo. */
export function MediaPreviewModal({ item, onClose, justUploaded = false }: { item: GbpMediaItem; onClose: () => void; /** Opened right after upload: title says it's saved and asks to publish. */ justUploaded?: boolean }) {
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
  const insets = useSafeAreaInsets();
  const failure = item.failureReason && /mongodb|twilio|stack|internal server|meta error|graph api/i.test(item.failureReason)
    ? 'This item could not be published. Please try again.'
    : item.failureReason;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between px-4">
          <View className="flex-1">
            <Text className="font-sans-bold text-sm text-on-brand" numberOfLines={2}>
              {justUploaded ? `${itemLabel(item)} uploaded` : itemLabel(item)}
            </Text>
            {justUploaded && item.status === 'staged' && (
              <Text className="mt-0.5 font-sans text-xs text-zinc-400" numberOfLines={2}>
                Publish it to Google now, or schedule it for later.
              </Text>
            )}
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={26} color="#ffffff" />
          </Pressable>
        </View>
        <View className="min-h-[120px] flex-1 items-center justify-center px-4">
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
        {!!failure && (
          <Text className="px-5 pb-2 text-center font-sans text-xs" style={{ color: t.rose }}>{failure}</Text>
        )}
        {!!geotagLine(item.geotag) && (
          <Text className="px-5 pb-2 text-center font-sans text-xs text-zinc-400">{geotagLine(item.geotag)}</Text>
        )}
        {item.scheduledFor && isStaged && (
          <Text className="px-5 pb-2 text-center font-sans text-xs text-zinc-400">
            Scheduled to publish on {formatDateTime(item.scheduledFor)}
          </Text>
        )}
        <ScrollView
          style={{ flexGrow: 0, maxHeight: '48%' }}
          contentContainerStyle={{ gap: 10, paddingHorizontal: 20, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 16) }}
          keyboardShouldPersistTaps="handled"
        >
          {isStaged && (
            <Pressable
              onPress={() => publish.mutate()}
              disabled={publish.isPending}
              // No `className` — react-native-css-interop can swallow onPress
              // on styled Pressables (see components/ui.tsx).
              style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, backgroundColor: t.brand, paddingVertical: 12, opacity: publish.isPending ? 0.6 : 1 }}
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
              style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, borderWidth: 1, borderColor: t.border, paddingVertical: 12 }}
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
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, borderWidth: 1, borderColor: t.rose, paddingVertical: 12 }}
          >
            <Ionicons name="trash-outline" size={17} color={t.rose} />
            <Text className="font-sans-bold text-base" style={{ color: t.rose }}>
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
      {picker.element}
      {info.node}
      {confirmSheet.node}
    </Modal>
  );
}

