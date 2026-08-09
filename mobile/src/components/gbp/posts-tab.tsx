import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import type { ContentPost } from '@/api/endpoints/content';
import { fetchPublishedPosts } from '@/api/endpoints/content';
import { fetchDashboardStats } from '@/api/endpoints/dashboard';
import { fetchBuffer, generateBufferPosts } from '@/api/endpoints/scheduler';
import { useBusiness } from '@/business/BusinessContext';
import { SchedulerPanel } from '@/components/scheduler-panel';
import { PrimaryButton, Skeleton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

const UPCOMING_WINDOW_DAYS = 7;

/** Badge shown on every post card — same "Update Post" vs. real postType
 *  logic the old inline card used. */
function PostBadge({ post }: { post: ContentPost }) {
  const isUpdate = (post.postType ?? '').toLowerCase().includes('update') || !post.postType;
  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-full bg-warning-container px-3 py-1.5">
      <Ionicons name="newspaper-outline" size={13} color="#f5a524" />
      <Text className="font-sans-bold text-xs text-on-warning-container">
        {isUpdate ? 'Update Post' : post.postType}
      </Text>
    </View>
  );
}

/** Fixed-width card for the horizontal "Upcoming Posts" carousel. */
function UpcomingPostCard({ post }: { post: ContentPost }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <View
      className="mr-3 overflow-hidden rounded-card border border-surface-border bg-surface-raised"
      style={{ width: 260 }}
    >
      <View className="h-40 bg-surface-overlay">
        {post.imageUrl && <Image source={{ uri: post.imageUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />}
        <View className="absolute left-2.5 top-2.5">
          <PostBadge post={post} />
        </View>
      </View>
      <View className="p-4">
        <Text className="font-sans-bold text-base leading-6 text-white" numberOfLines={2}>
          {post.title || post.content?.slice(0, 80) || 'Untitled post'}
        </Text>
        {!!post.scheduledDate && (
          <View className="mt-2 flex-row items-center gap-1.5">
            <Ionicons name="calendar-outline" size={13} color={t.textFaint} />
            <Text className="font-sans text-xs text-zinc-500">
              Scheduled for: {new Date(post.scheduledDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
          </View>
        )}
        <Pressable
          onPress={() => router.push(`/posts/${post._id}` as never)}
          // No `className` — react-native-css-interop can swallow onPress
          // on styled Pressables (see components/ui.tsx).
          style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: t.border, paddingTop: 12, alignItems: 'center' }}
        >
          <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
            View Post
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Full-width card for the vertical "Recent Posts" list. */
function RecentPostCard({ post }: { post: ContentPost }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <View className="mb-3 overflow-hidden rounded-card border border-surface-border bg-surface-raised">
      <View className="h-44 bg-surface-overlay">
        {post.imageUrl && <Image source={{ uri: post.imageUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />}
        <View className="absolute left-2.5 top-2.5">
          <PostBadge post={post} />
        </View>
      </View>
      <View className="p-4">
        <Text className="font-sans-bold text-base leading-6 text-white" numberOfLines={2}>
          {post.title || 'Untitled post'}
        </Text>
        {!!post.content && (
          <Text className="mt-1 font-sans text-sm text-zinc-400" numberOfLines={2}>
            {post.content}
          </Text>
        )}
        <View className="mt-2 flex-row items-center gap-1.5">
          <Ionicons name="calendar-outline" size={13} color={t.textFaint} />
          <Text className="font-sans text-xs text-zinc-500">
            Posted on: {new Date(post.publishedAt ?? post.createdAt ?? '').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push(`/posts/${post._id}` as never)}
          // No `className` — see note above.
          style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: t.border, paddingTop: 12, alignItems: 'center' }}
        >
          <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
            View Post
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * GBP → Posts: upcoming posts (next 7 days, horizontal carousel) + manual
 * "+" create + AI "Generate Posts" + Recent Posts history (paginated,
 * published only) + the embedded scheduler (buffer health / drafts —
 * upcoming list suppressed there now, see SchedulerPanel's showUpcoming).
 */
export function PostsTab() {
  const { activeBusinessId } = useBusiness();
  const router = useRouter();
  const t = useTheme();
  const queryClient = useQueryClient();

  const buffer = useQuery({
    queryKey: ['scheduler-buffer', activeBusinessId],
    queryFn: fetchBuffer,
    enabled: !!activeBusinessId,
  });
  // Real total ("Recent Posts 319") — same number Home's stat list already
  // shows, so the two never disagree.
  const stats = useQuery({
    queryKey: ['dashboard-stats', activeBusinessId],
    queryFn: () => fetchDashboardStats(30),
    enabled: !!activeBusinessId,
  });

  const recent = useInfiniteQuery({
    queryKey: ['published-posts', activeBusinessId],
    queryFn: ({ pageParam }) => fetchPublishedPosts(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length + 1 : undefined),
    enabled: !!activeBusinessId,
  });

  const generate = useMutation({
    mutationFn: generateBufferPosts,
    onSuccess: () => {
      setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer'] }),
        6000
      );
    },
  });

  const now = Date.now();
  const windowEnd = now + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const upcoming = (buffer.data?.upcomingPosts ?? []).filter((p) => {
    if (!p.scheduledDate) return false;
    const ts = new Date(p.scheduledDate).getTime();
    return ts >= now - 60 * 60 * 1000 && ts <= windowEnd;
  });
  const recentPosts = recent.data?.pages.flatMap((p) => p.posts) ?? [];

  return (
    <View className="px-4">
      <View className="flex-row items-center justify-between pt-2">
        <View className="flex-row items-center gap-2">
          <Text className="font-display-bold text-lg text-white">Upcoming Posts</Text>
          <View className="h-6 min-w-6 items-center justify-center rounded-full bg-surface-overlay px-1.5">
            <Text className="font-sans-bold text-xs text-zinc-300">{upcoming.length}</Text>
          </View>
        </View>
        <Pressable onPress={() => router.push('/posts/create' as never)} hitSlop={10}>
          <Ionicons name="add-circle-outline" size={26} color={t.brandBright} />
        </Pressable>
      </View>

      <View className="mt-4">
        {buffer.isLoading ? (
          <Skeleton className="h-64 rounded-card" />
        ) : upcoming.length === 0 ? (
          <View className="items-center rounded-card border border-surface-border bg-surface-raised px-5 py-8">
            <Text className="mb-1 font-sans-semibold text-base text-zinc-300">
              No posts in the next 7 days
            </Text>
            <Text className="mb-4 text-center font-sans text-sm text-zinc-500">
              Write one yourself, or let AI generate a week of content.
            </Text>
            <PrimaryButton
              title={generate.isPending ? 'Generating…' : 'Generate Posts'}
              onPress={() => generate.mutate()}
              loading={generate.isPending}
            />
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="pr-1">
            {upcoming.map((post) => (
              <UpcomingPostCard key={post._id} post={post} />
            ))}
          </ScrollView>
        )}
      </View>

      {upcoming.length > 0 && (
        <Pressable
          onPress={() => generate.mutate()}
          disabled={generate.isPending}
          // No `className` — see note above.
          style={{
            marginTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.border,
            paddingVertical: 10,
            opacity: generate.isPending ? 0.6 : 1,
          }}
        >
          <Ionicons name="sparkles" size={14} color={t.brandBright} />
          <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
            {generate.isPending ? 'Generating…' : 'Generate more with AI'}
          </Text>
        </Pressable>
      )}

      <View
        className="mt-4 flex-row items-center gap-2.5 rounded-card px-4 py-3.5"
        style={{ backgroundColor: `${t.brand}1f`, borderWidth: 1, borderColor: `${t.brand}44` }}
      >
        <Text className="text-base">✨</Text>
        <Text className="flex-1 font-sans text-sm leading-5 text-zinc-200">
          Posts will be published once our AI finalizes keywords & optimizations
        </Text>
      </View>

      {/* Recent Posts — real publish history, not just this week's calendar window. */}
      <View className="mt-8 flex-row items-center gap-2">
        <Text className="font-display-bold text-lg text-white">Recent Posts</Text>
        <View className="h-6 min-w-6 items-center justify-center rounded-full bg-surface-overlay px-1.5">
          <Text className="font-sans-bold text-xs text-zinc-300">
            {stats.data?.metrics.postsPublished ?? recentPosts.length}
          </Text>
        </View>
      </View>
      <View className="mt-3">
        {recent.isLoading ? (
          <>
            <Skeleton className="mb-3 h-64 rounded-card" />
            <Skeleton className="h-64 rounded-card" />
          </>
        ) : recentPosts.length === 0 ? (
          <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-6">
            <Text className="font-sans text-sm text-zinc-400">No posts published yet.</Text>
          </View>
        ) : (
          <>
            {recentPosts.map((post) => (
              <RecentPostCard key={post._id} post={post} />
            ))}
            {recent.hasNextPage && (
              <Pressable
                onPress={() => void recent.fetchNextPage()}
                disabled={recent.isFetchingNextPage}
                // No `className` — see note above.
                style={{ alignItems: 'center', paddingVertical: 12 }}
              >
                <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
                  {recent.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>

      {/* Buffer health + unscheduled drafts (upcoming list suppressed —
          already shown richer, above). */}
      <View className="-mx-4 mt-4 border-t border-surface-border pt-2">
        <SchedulerPanel scrollable={false} showUpcoming={false} />
      </View>
    </View>
  );
}
