import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { deletePost, fetchPost, publishPost, schedulePost } from '@/api/endpoints/scheduler';
import { useDateTimePicker } from '@/components/datetime-picker';
import { EditPostModal } from '@/components/gbp/edit-post-modal';
import { Badge, LoadingScreen, Screen, Skeleton, useConfirmSheet, useInfoSheet } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/** "⋮" bottom-sheet options menu — Edit / Reschedule / Publish now / Delete,
 *  matching the app's existing bottom-sheet pattern (business switcher,
 *  EditPostModal) rather than Alert.alert, which gets cramped past 2-3
 *  buttons. Actions are the same mutations SchedulerPanel already has. */
function OptionsMenu({
  visible,
  onClose,
  isPublished,
  onEdit,
  onReschedule,
  onPublishNow,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  isPublished: boolean;
  onEdit: () => void;
  onReschedule: () => void;
  onPublishNow: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  const row = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void, danger = false) => (
    <Pressable
      onPress={() => {
        onClose();
        onPress();
      }}
      // No `className` — react-native-css-interop can swallow onPress on
      // styled Pressables (see components/ui.tsx).
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 4 }}
    >
      <Ionicons name={icon} size={18} color={danger ? t.rose : t.text} />
      <Text className="font-sans-semibold text-base" style={{ color: danger ? t.rose : t.text }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={onClose} />
      <View className="rounded-t-3xl border-t border-surface-border bg-surface px-5 pb-8 pt-3">
        <View className="mb-2 self-center h-1 w-10 rounded-full bg-surface-overlay" />
        {!isPublished && row('pencil-outline', 'Edit', onEdit)}
        {!isPublished && row('calendar-outline', 'Reschedule', onReschedule)}
        {!isPublished && row('send-outline', 'Publish now', onPublishNow)}
        {!isPublished && row('trash-outline', 'Delete', onDelete, true)}
        {isPublished && (
          <Text className="py-4 font-sans text-sm text-zinc-500">
            This post is already live — published posts can&apos;t be edited, rescheduled, or deleted.
          </Text>
        )}
      </View>
    </Modal>
  );
}

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const queryClient = useQueryClient();
  const picker = useDateTimePicker();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const info = useInfoSheet();
  const confirmSheet = useConfirmSheet();

  const post = useQuery({
    queryKey: ['post', id],
    queryFn: () => fetchPost(id!),
    enabled: !!id,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['post', id] });
    void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer'] });
    void queryClient.invalidateQueries({ queryKey: ['published-posts'] });
  };

  const publish = useMutation({
    mutationFn: () => publishPost(id!),
    onSuccess: invalidate,
    onError: (err) => info.show('Error', getApiErrorMessage(err, 'Could not publish the post.')),
  });
  const reschedule = useMutation({
    mutationFn: (date: Date) => schedulePost(id!, date),
    onSuccess: invalidate,
    onError: (err) => info.show('Error', getApiErrorMessage(err, 'Could not reschedule.')),
  });
  const remove = useMutation({
    mutationFn: () => deletePost(id!),
    onSuccess: () => {
      invalidate();
      router.back();
    },
    onError: (err) => info.show('Error', getApiErrorMessage(err, 'Could not delete the post.')),
  });

  if (post.isLoading) return <LoadingScreen />;
  if (!post.data) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="font-sans text-sm text-zinc-500">Couldn&apos;t load this post.</Text>
        </View>
      </Screen>
    );
  }

  const p = post.data;
  const isPublished = p.status === 'published';
  const isUpdate = (p.postType ?? '').toLowerCase().includes('update') || !p.postType;

  return (
    <Screen>
      <ScrollView contentContainerClassName="pb-10">
        <View className="flex-row items-center justify-between px-4 pb-3 pt-4">
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="arrow-back" size={22} color={t.text} />
          </Pressable>
          <Text className="font-display-bold text-lg text-white">Post</Text>
          <Pressable onPress={() => setMenuOpen(true)} hitSlop={10}>
            <Ionicons name="ellipsis-vertical" size={20} color={t.text} />
          </Pressable>
        </View>

        {p.imageUrl && (
          <Image source={{ uri: p.imageUrl }} style={{ width: '100%', aspectRatio: 4 / 3 }} contentFit="cover" />
        )}

        <View className="px-4 pt-4">
          <Badge label={isUpdate ? 'Update Post' : (p.postType ?? 'Standard Post')} tone="warning" />

          <View className="mt-3 flex-row items-center gap-1.5">
            <Ionicons name="calendar-outline" size={14} color={t.textFaint} />
            <Text className="font-sans-semibold text-sm text-zinc-400">
              {isPublished
                ? `Posted on: ${formatDateTime(p.publishedAt)}`
                : p.scheduledDate
                  ? `Scheduled for: ${formatDateTime(p.scheduledDate)}`
                  : 'Not scheduled yet'}
            </Text>
          </View>

          {!!p.title && (
            <Text className="mt-3 font-display-bold text-xl leading-7 text-white">{p.title}</Text>
          )}
          {!!p.content && (
            <Text className="mt-3 font-sans text-base leading-6 text-zinc-300">{p.content}</Text>
          )}
        </View>
      </ScrollView>

      <OptionsMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        isPublished={isPublished}
        onEdit={() => setEditing(true)}
        onReschedule={() =>
          picker.open(p.scheduledDate ? new Date(p.scheduledDate) : new Date(), (date) =>
            reschedule.mutate(date)
          )
        }
        onPublishNow={() =>
          confirmSheet.confirm({
            title: 'Publish now?',
            message: `"${p.title || 'This post'}" will go live immediately.`,
            confirmLabel: 'Publish',
            onConfirm: () => publish.mutate(),
          })
        }
        onDelete={() =>
          confirmSheet.confirm({
            title: 'Delete post?',
            message: 'This removes the post permanently.',
            confirmLabel: 'Delete',
            destructive: true,
            onConfirm: () => remove.mutate(),
          })
        }
      />
      {picker.element}
      {editing && <EditPostModal post={p} onClose={() => setEditing(false)} />}
      {info.node}
      {confirmSheet.node}
    </Screen>
  );
}
