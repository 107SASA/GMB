import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { type ContentPost } from '@/api/endpoints/content';
import { deletePost, fetchBuffer, publishPost, schedulePost } from '@/api/endpoints/scheduler';
import { useBusiness } from '@/business/BusinessContext';
import { useDateTimePicker } from '@/components/datetime-picker';
import { Badge, EmptyState, SectionLabel, Skeleton } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

/**
 * The Content Scheduler body — buffer health + scheduled/draft posts with
 * publish / reschedule / delete. Shared by the Scheduler screen (scrollable)
 * and the GBP → Posts tab (embedded inside that tab's own scroll view).
 */

const HEALTH_STYLES = {
  Healthy: { tone: 'positive' as const, bar: 'bg-emerald-500' },
  Warning: { tone: 'warning' as const, bar: 'bg-amber-400' },
  Critical: { tone: 'negative' as const, bar: 'bg-rose-400' },
};

function BufferCard({
  healthStatus,
  daysCovered,
  missingDays,
  totalScheduledPosts,
}: {
  healthStatus: keyof typeof HEALTH_STYLES;
  daysCovered: number;
  missingDays: number;
  totalScheduledPosts: number;
}) {
  const style = HEALTH_STYLES[healthStatus];
  const pct = Math.min(100, Math.round((daysCovered / 7) * 100));
  return (
    <View className="rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-white">Post buffer</Text>
        <Badge label={healthStatus} tone={style.tone} />
      </View>
      <View className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <View className={`h-full rounded-full ${style.bar}`} style={{ width: `${pct}%` }} />
      </View>
      <Text className="mt-2 text-xs text-zinc-400">
        {daysCovered} of the next 7 days covered · {totalScheduledPosts} scheduled
        {missingDays > 0 ? ` · ${missingDays} day${missingDays === 1 ? '' : 's'} missing` : ''}
      </Text>
    </View>
  );
}

function PostRow({
  post,
  onPublish,
  onReschedule,
  onDelete,
}: {
  post: ContentPost;
  onPublish: () => void;
  onReschedule: () => void;
  onDelete: () => void;
}) {
  const isPublished = post.status === 'published';
  return (
    <View className="mb-3 rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-base font-semibold text-white" numberOfLines={1}>
          {post.title || 'Untitled post'}
        </Text>
        <Badge
          label={isPublished ? 'Published' : post.scheduledDate ? 'Scheduled' : 'Draft'}
          tone={isPublished ? 'positive' : post.scheduledDate ? 'info' : 'neutral'}
        />
      </View>
      <Text className="mt-1 text-sm text-zinc-400" numberOfLines={2}>
        {post.content}
      </Text>
      <Text className="mt-1.5 text-xs text-zinc-500">
        {isPublished
          ? `Published ${formatDateTime(post.publishedAt)}`
          : post.scheduledDate
            ? formatDateTime(post.scheduledDate)
            : 'Not scheduled yet'}
      </Text>
      {!isPublished && (
        <View className="mt-3 flex-row gap-2">
          <Pressable
            onPress={onPublish}
            className="flex-row items-center gap-1 rounded-full border border-surface-border px-3 py-1.5 active:opacity-70"
          >
            <Ionicons name="send-outline" size={13} color="#8B93B8" />
            <Text className="text-xs font-medium text-zinc-300">Publish now</Text>
          </Pressable>
          <Pressable
            onPress={onReschedule}
            className="flex-row items-center gap-1 rounded-full border border-surface-border px-3 py-1.5 active:opacity-70"
          >
            <Ionicons name="calendar-outline" size={13} color="#8B93B8" />
            <Text className="text-xs font-medium text-zinc-300">Reschedule</Text>
          </Pressable>
          <Pressable
            onPress={onDelete}
            className="flex-row items-center gap-1 rounded-full border border-rose-400/25 px-3 py-1.5 active:opacity-70"
          >
            <Ionicons name="trash-outline" size={13} color="#FB7185" />
            <Text className="text-xs font-medium text-rose-300">Delete</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export function SchedulerPanel({ scrollable = true }: { scrollable?: boolean }) {
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const picker = useDateTimePicker();

  const buffer = useQuery({
    queryKey: ['scheduler-buffer', activeBusinessId],
    queryFn: fetchBuffer,
    enabled: !!activeBusinessId,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer', activeBusinessId] });
    void queryClient.invalidateQueries({ queryKey: ['content-posts', activeBusinessId] });
  };

  const publish = useMutation({
    mutationFn: (postId: string) => publishPost(postId),
    onSuccess: invalidate,
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not publish the post.')),
  });

  const reschedule = useMutation({
    mutationFn: ({ postId, date }: { postId: string; date: Date }) => schedulePost(postId, date),
    onSuccess: invalidate,
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not reschedule.')),
  });

  const remove = useMutation({
    mutationFn: (postId: string) => deletePost(postId),
    onSuccess: invalidate,
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not delete the post.')),
  });

  function confirmPublish(post: ContentPost) {
    Alert.alert('Publish now?', `"${post.title || 'This post'}" will go live immediately.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Publish', onPress: () => publish.mutate(post._id) },
    ]);
  }

  function confirmDelete(post: ContentPost) {
    Alert.alert('Delete post?', 'This removes the post permanently.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(post._id) },
    ]);
  }

  const data = buffer.data;
  const upcoming = data?.upcomingPosts ?? [];
  const drafts = (data?.allPosts ?? []).filter(
    (p) => p.status !== 'published' && !p.scheduledDate
  );

  if (buffer.isLoading) {
    return (
      <View className="mt-3 gap-3 px-5">
        <Skeleton className="h-24" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </View>
    );
  }
  if (buffer.isError) {
    return (
      <EmptyState
        title="Couldn't load the scheduler"
        hint={getApiErrorMessage(buffer.error, 'Pull down to retry.')}
      />
    );
  }

  const body = (
    <>
      <View className="px-5">
        <BufferCard
          healthStatus={data!.healthStatus}
          daysCovered={data!.daysCovered}
          missingDays={data!.missingDays}
          totalScheduledPosts={data!.totalScheduledPosts}
        />
      </View>

      <View className="px-5">
        <SectionLabel>Upcoming posts</SectionLabel>
        {upcoming.length === 0 ? (
          <Text className="px-1 text-sm text-zinc-500">
            Nothing scheduled. Generate posts or schedule drafts from the Content tab.
          </Text>
        ) : (
          upcoming.map((post) => (
            <PostRow
              key={post._id}
              post={post}
              onPublish={() => confirmPublish(post)}
              onReschedule={() =>
                picker.open(
                  post.scheduledDate ? new Date(post.scheduledDate) : new Date(),
                  (date) => reschedule.mutate({ postId: post._id, date })
                )
              }
              onDelete={() => confirmDelete(post)}
            />
          ))
        )}

        {drafts.length > 0 && (
          <>
            <SectionLabel>Unscheduled drafts</SectionLabel>
            {drafts.map((post) => (
              <PostRow
                key={post._id}
                post={post}
                onPublish={() => confirmPublish(post)}
                onReschedule={() =>
                  picker.open(new Date(Date.now() + 24 * 60 * 60 * 1000), (date) =>
                    reschedule.mutate({ postId: post._id, date })
                  )
                }
                onDelete={() => confirmDelete(post)}
              />
            ))}
          </>
        )}
      </View>
      {picker.element}
    </>
  );

  if (!scrollable) return <View>{body}</View>;

  return (
    <ScrollView
      contentContainerClassName="pb-12 pt-3"
      refreshControl={
        <RefreshControl
          refreshing={buffer.isRefetching}
          onRefresh={() => void buffer.refetch()}
          tintColor="#6366F1"
        />
      }
    >
      {body}
    </ScrollView>
  );
}
