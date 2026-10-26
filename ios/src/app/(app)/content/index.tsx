import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  fetchContentPosts,
  type ContentPost,
} from '@/api/endpoints/content';
import { deletePost, schedulePost, updatePost } from '@/api/endpoints/scheduler';
import { useBusiness } from '@/business/BusinessContext';
import { useDateTimePicker } from '@/components/datetime-picker';
import {
  Badge,
  BottomSheet,
  EmptyState,
  Field,
  LabeledField,
  PrimaryButton,
  Screen,
  ScreenTitle,
  Skeleton,
  useConfirmSheet,
  useInfoSheet,
} from '@/components/ui';
import { useTheme, withAlpha } from '@/lib/theme';
import { formatDateTime } from '@/lib/format';
import { useRefreshContentOnFocus } from '@/lib/useRefreshContentOnFocus';

/**
 * Content — the weekly posts the autopilot created (4 per week, generated and
 * scheduled automatically from the SEO plan). Read + manage existing posts
 * only: there is deliberately no "generate" action here (removed Oct 2026 —
 * manual batches caused duplicate posts and extra AI / image cost). The web
 * Content page shows the same posts from the same API.
 */
function AutopilotInfo() {
  const t = useTheme();
  return (
    <View className="mx-5 mb-3 flex-row items-start gap-2.5 rounded-card border border-surface-border bg-surface-raised px-4 py-3">
      <Ionicons name="sparkles-outline" size={16} color={t.brandBright} style={{ marginTop: 2 }} />
      <View className="flex-1">
        <Text className="font-sans-semibold text-sm text-white">Your weekly posts are generated automatically.</Text>
        <Text className="mt-0.5 font-sans text-xs leading-4 text-zinc-400">
          4 posts are planned every week based on your SEO plan, business information, keywords, offers and relevant festivals.
        </Text>
      </View>
    </View>
  );
}

// --- History segment ----------------------------------------------------------

function postStatusBadge(post: ContentPost): { label: string; tone: 'neutral' | 'info' | 'positive' } {
  if (post.status === 'published') return { label: 'Published', tone: 'positive' };
  if (post.status === 'scheduled' || post.scheduledDate)
    return { label: 'Scheduled', tone: 'info' };
  return { label: 'Draft', tone: 'neutral' };
}

function HistoryCard({
  post,
  onSchedule,
  onEdit,
  onDelete,
}: {
  post: ContentPost;
  onSchedule: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  const status = postStatusBadge(post);
  const published = post.status === 'published';
  return (
    <View className="mb-3 rounded-card border border-surface-border bg-surface-raised px-4 py-3.5">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 font-sans-semibold text-base text-white" numberOfLines={1}>
          {post.title || 'Untitled post'}
        </Text>
        <Badge label={status.label} tone={status.tone} />
      </View>
      <Text className="mt-1.5 font-sans text-sm text-zinc-400" numberOfLines={3}>
        {post.content}
      </Text>
      {!!post.scheduledDate && !published && (
        <Text className="mt-1.5 font-sans text-xs text-zinc-500">
          Scheduled for {formatDateTime(post.scheduledDate)}
        </Text>
      )}
      {!published && (
        <View className="mt-3 flex-row gap-2">
          <Pressable
            onPress={onSchedule}
            // No `className` — see components/ui.tsx PrimaryButton note.
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <Ionicons name="calendar-outline" size={13} color={t.textFaint} />
            <Text className="font-sans-semibold text-xs text-zinc-300">Schedule</Text>
          </Pressable>
          <Pressable
            onPress={onEdit}
            // No `className` — see note above.
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <Ionicons name="pencil-outline" size={13} color={t.textFaint} />
            <Text className="font-sans-semibold text-xs text-zinc-300">Edit</Text>
          </Pressable>
          <Pressable
            onPress={onDelete}
            // No `className` — see note above.
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, borderColor: withAlpha(t.rose, 0.25), paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <Ionicons name="trash-outline" size={13} color={t.rose} />
            <Text className="font-sans-semibold text-xs text-rose-300">Delete</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function EditPostModal({
  post,
  onClose,
  onSaved,
}: {
  post: ContentPost;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content);
  const info = useInfoSheet();

  const save = useMutation({
    mutationFn: () => updatePost(post._id, { title, content }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err) => info.show('Error', getApiErrorMessage(err, 'Could not save the post.')),
  });

  return (
    <>
    <BottomSheet visible onClose={onClose}>
          <Text className="mb-3 font-display-bold text-lg text-white">Edit post</Text>
            <LabeledField label="Title" value={title} onChangeText={setTitle} />
            <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">Content</Text>
            <Field
              value={content}
              onChangeText={setContent}
              multiline
              textAlignVertical="top"
              className="min-h-[140px] mb-4"
            />
            <PrimaryButton
              title="Save changes"
              onPress={() => save.mutate()}
              loading={save.isPending}
              disabled={!content.trim()}
            />
            <Pressable onPress={onClose} style={{ marginTop: 12, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text className="font-sans-semibold text-sm text-zinc-400">Cancel</Text>
            </Pressable>
    </BottomSheet>
    {info.node}
    </>
  );
}

function HistorySegment() {
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const picker = useDateTimePicker();
  const t = useTheme();
  const [editing, setEditing] = useState<ContentPost | null>(null);
  const info = useInfoSheet();
  const confirmSheet = useConfirmSheet();

  const history = useInfiniteQuery({
    queryKey: ['content-posts', activeBusinessId],
    queryFn: ({ pageParam }) => fetchContentPosts(activeBusinessId!, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
    enabled: !!activeBusinessId,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['content-posts', activeBusinessId] });
    void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer', activeBusinessId] });
  };

  const schedule = useMutation({
    mutationFn: ({ postId, date }: { postId: string; date: Date }) => schedulePost(postId, date),
    onSuccess: invalidate,
    onError: (err) => info.show('Error', getApiErrorMessage(err, 'Could not schedule the post.')),
  });

  const remove = useMutation({
    mutationFn: (postId: string) => deletePost(postId),
    onSuccess: invalidate,
    onError: (err) => info.show('Error', getApiErrorMessage(err, 'Could not delete the post.')),
  });

  const posts = history.data?.pages.flatMap((page) => page.posts) ?? [];

  function confirmDelete(post: ContentPost) {
    confirmSheet.confirm({
      title: 'Delete post?',
      message: 'This removes the draft permanently.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => remove.mutate(post._id),
    });
  }

  if (history.isLoading) {
    return (
      <View className="gap-3 px-5">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </View>
    );
  }
  if (history.isError) {
    return (
      <EmptyState
        title="Couldn't load content history"
        hint={getApiErrorMessage(history.error, 'Try again.')}
      />
    );
  }

  return (
    <>
      <FlatList
        data={posts}
        keyExtractor={(p) => p._id}
        renderItem={({ item }) => (
          <HistoryCard
            post={item}
            onSchedule={() =>
              picker.open(new Date(Date.now() + 24 * 60 * 60 * 1000), (date) =>
                schedule.mutate({ postId: item._id, date })
              )
            }
            onEdit={() => setEditing(item)}
            onDelete={() => confirmDelete(item)}
          />
        )}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 }}
        onEndReached={() => {
          if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          history.isFetchingNextPage ? (
            <ActivityIndicator color={t.brandBright} style={{ paddingVertical: 12 }} />
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            title="No content yet"
            hint="Your weekly posts appear here automatically once the first batch is ready — 4 posts every week."
          />
        }
      />
      {picker.element}
      {editing && (
        <EditPostModal post={editing} onClose={() => setEditing(null)} onSaved={invalidate} />
      )}
      {info.node}
      {confirmSheet.node}
    </>
  );
}

// --- Screen ---------------------------------------------------------------------

export default function ContentScreen() {
  useRefreshContentOnFocus();
  return (
    <Screen>
      <ScreenTitle>Content</ScreenTitle>
      <AutopilotInfo />
      <HistorySegment />
    </Screen>
  );
}
