import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import type { ContentPost } from '@/api/endpoints/content';
import {
  deletePost,
  fetchBuffer,
  generateBufferPosts,
  updatePost,
} from '@/api/endpoints/scheduler';
import { useBusiness } from '@/business/BusinessContext';
import { SchedulerPanel } from '@/components/scheduler-panel';
import { Field, PrimaryButton, SecondaryButton, Skeleton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

const UPCOMING_WINDOW_DAYS = 7;

/** Modal form for editing a scheduled post's title/content. */
function EditPostModal({ post, onClose }: { post: ContentPost; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content);

  const save = useMutation({
    mutationFn: () => updatePost(post._id, { title: title.trim(), content: content.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer'] });
      onClose();
    },
    onError: (error) =>
      Alert.alert('Could not save', getApiErrorMessage(error, 'Please try again.')),
  });

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60" onPress={onClose} />
      <View className="rounded-t-3xl border-t border-surface-border bg-surface p-5 pb-8">
        <Text className="mb-4 text-lg font-bold text-white">Edit Post</Text>
        <Text className="mb-1.5 px-1 text-xs font-semibold text-zinc-400">Title</Text>
        <Field value={title} onChangeText={setTitle} placeholder="Post title" />
        <Text className="mb-1.5 mt-3 px-1 text-xs font-semibold text-zinc-400">Content</Text>
        <Field
          value={content}
          onChangeText={setContent}
          placeholder="Post content"
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          className="min-h-32"
        />
        <View className="mt-5 gap-3">
          <PrimaryButton
            title="Save Changes"
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={!title.trim() && !content.trim()}
          />
          <SecondaryButton title="Cancel" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function PostCard({ post, onEdit }: { post: ContentPost; onEdit: () => void }) {
  const t = useTheme();
  const queryClient = useQueryClient();
  const isUpdate = (post.postType ?? '').toLowerCase().includes('update') || !post.postType;

  const remove = useMutation({
    mutationFn: () => deletePost(post._id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer'] }),
    onError: (error) =>
      Alert.alert('Could not delete', getApiErrorMessage(error, 'Please try again.')),
  });

  const confirmDelete = () => {
    Alert.alert('Delete post?', `"${post.title || 'Untitled post'}" will be removed from the schedule.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
    ]);
  };

  return (
    <View
      className="mb-3 overflow-hidden rounded-3xl border border-surface-border bg-surface-raised"
      style={{ opacity: remove.isPending ? 0.5 : 1 }}
    >
      <View className="h-24 justify-between bg-surface-overlay p-3">
        <View className="flex-row items-start justify-between">
          <View
            className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ backgroundColor: `${t.amber}33` }}
          >
            <Ionicons name="newspaper-outline" size={13} color={t.amber} />
            <Text className="text-xs font-bold" style={{ color: t.amber }}>
              {isUpdate ? 'Update Post' : post.postType}
            </Text>
          </View>
          <View className="flex-row gap-1.5">
            <Pressable
              onPress={onEdit}
              className="h-9 w-9 items-center justify-center rounded-full bg-surface active:opacity-70"
            >
              <Ionicons name="pencil" size={15} color={t.brandBright} />
            </Pressable>
            <Pressable
              onPress={confirmDelete}
              disabled={remove.isPending}
              className="h-9 w-9 items-center justify-center rounded-full bg-surface active:opacity-70"
            >
              <Ionicons name="trash-outline" size={15} color={t.rose} />
            </Pressable>
          </View>
        </View>
        {!!post.scheduledDate && (
          <Text className="text-xs text-zinc-500">
            Scheduled{' '}
            {new Date(post.scheduledDate).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </Text>
        )}
      </View>
      <View className="p-4">
        <Text className="text-base font-bold leading-6 text-white" numberOfLines={2}>
          {post.title || post.content?.slice(0, 80) || 'Untitled post'}
        </Text>
        {!!post.content && (
          <Text className="mt-1 text-sm text-zinc-400" numberOfLines={2}>
            {post.content}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * GBP → Posts: scheduled posts landing in the NEXT 7 DAYS, with generate
 * (kicks the buffer job, which auto-schedules across the coming week, then
 * opens the Content Scheduler) plus per-post edit and delete.
 */
export function PostsTab() {
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const t = useTheme();
  const [editing, setEditing] = useState<ContentPost | null>(null);

  const buffer = useQuery({
    queryKey: ['scheduler-buffer', activeBusinessId],
    queryFn: fetchBuffer,
    enabled: !!activeBusinessId,
  });

  const generate = useMutation({
    mutationFn: generateBufferPosts,
    onSuccess: () => {
      // Generation runs as a background job; posts get auto-scheduled across
      // the next 7 days and show up below once the buffer refetches.
      setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer'] }),
        6000
      );
      Alert.alert(
        'Generating posts',
        'AI is writing your posts now — they will be scheduled automatically over the next 7 days and appear below shortly.'
      );
    },
    onError: (error) =>
      Alert.alert('Could not generate', getApiErrorMessage(error, 'Please try again.')),
  });

  // Only posts scheduled inside the coming 7-day window (the buffer's
  // upcomingPosts can reach further out).
  const now = Date.now();
  const windowEnd = now + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const upcoming = (buffer.data?.upcomingPosts ?? []).filter((p) => {
    if (!p.scheduledDate) return false;
    const ts = new Date(p.scheduledDate).getTime();
    return ts >= now - 60 * 60 * 1000 && ts <= windowEnd;
  });

  return (
    <View className="px-4">
      <View className="flex-row items-center justify-between pt-2">
        <View className="flex-row items-center gap-2">
          <View>
            <Text className="text-lg font-extrabold text-white">Upcoming Posts</Text>
            <Text className="text-xs text-zinc-500">Next 7 days</Text>
          </View>
          <View className="h-6 min-w-6 items-center justify-center rounded-full bg-surface-overlay px-1.5">
            <Text className="text-xs font-bold text-zinc-300">{upcoming.length}</Text>
          </View>
        </View>
        <Pressable
          onPress={() => generate.mutate()}
          disabled={generate.isPending}
          className="flex-row items-center gap-1.5 rounded-xl px-4 py-2.5 active:opacity-80"
          style={{ backgroundColor: t.brand, opacity: generate.isPending ? 0.6 : 1 }}
        >
          <Ionicons name="sparkles" size={14} color="#ffffff" />
          <Text className="text-sm font-bold text-white">
            {generate.isPending ? 'Generating…' : 'Generate Posts'}
          </Text>
        </Pressable>
      </View>

      <View
        className="mt-3 flex-row items-center gap-2.5 rounded-2xl px-4 py-3.5"
        style={{ backgroundColor: `${t.brand}1f`, borderWidth: 1, borderColor: `${t.brand}44` }}
      >
        <Text className="text-base">✨</Text>
        <Text className="flex-1 text-sm leading-5 text-zinc-200">
          Posts will be published once our AI finalizes keywords & optimizations
        </Text>
      </View>

      <View className="mt-4 pb-4">
        {buffer.isLoading ? (
          <>
            <Skeleton className="mb-3 h-48" />
            <Skeleton className="h-48" />
          </>
        ) : upcoming.length === 0 ? (
          <View className="items-center rounded-2xl border border-surface-border bg-surface-raised px-5 py-8">
            <Text className="mb-1 text-base font-semibold text-zinc-300">
              No posts in the next 7 days
            </Text>
            <Text className="text-center text-sm text-zinc-500">
              Tap Generate Posts and AI will write and schedule a week of content for you.
            </Text>
          </View>
        ) : (
          upcoming.map((post) => (
            <PostCard key={post._id} post={post} onEdit={() => setEditing(post)} />
          ))
        )}
      </View>

      {/* Full schedule management (buffer health, publish/reschedule/delete,
          drafts) — the scheduler itself, embedded under this tab. */}
      <View className="-mx-4 border-t border-surface-border pt-2">
        <SchedulerPanel scrollable={false} />
      </View>

      {editing && <EditPostModal post={editing} onClose={() => setEditing(null)} />}
    </View>
  );
}
