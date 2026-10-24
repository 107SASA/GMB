import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  fetchPublishedPosts,
  fetchUpcomingPosts,
  postStatusView,
  type ContentPost,
} from '@/api/endpoints/content';
import { useBusiness } from '@/business/BusinessContext';
import { Badge, PrimaryButton, Skeleton } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useRefreshContentOnFocus } from '@/lib/useRefreshContentOnFocus';

const POST_QUERY_OPTIONS = {
  staleTime: 0,
  refetchOnMount: 'always' as const,
};

function PostBadge({ post }: { post: ContentPost }) {
  const t = useTheme();
  const isUpdate = (post.postType ?? '').toLowerCase().includes('update') || !post.postType;
  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-full bg-warning-container px-3 py-1.5">
      <Ionicons name="newspaper-outline" size={13} color={t.amber} />
      <Text className="font-sans-bold text-xs text-on-warning-container">
        {isUpdate ? 'Update Post' : post.postType}
      </Text>
    </View>
  );
}

function StatusLine({ post }: { post: ContentPost }) {
  const sv = postStatusView(post);
  return <Badge label={sv.label} tone={sv.tone} />;
}

/** Card for the horizontal "Upcoming Posts" carousel. Width follows the phone. */
function UpcomingPostCard({ post, width }: { post: ContentPost; width: number }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <View
      className="mr-3 overflow-hidden rounded-card border border-surface-border bg-surface-raised"
      style={{ width }}
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
        <View className="mt-2">
          <StatusLine post={post} />
        </View>
        {!!post.scheduledDate && (
          <View className="mt-2 flex-row items-center gap-1.5">
            <Ionicons name="calendar-outline" size={13} color={t.textFaint} />
            <Text className="flex-1 font-sans text-xs text-zinc-500" numberOfLines={2}>
              Scheduled for: {formatDateTime(post.scheduledDate)}
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
            View / Edit
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
          {post.title || post.content?.slice(0, 80) || 'Untitled post'}
        </Text>
        {!!post.content && (
          <Text className="mt-1 font-sans text-sm text-zinc-400" numberOfLines={2}>
            {post.content}
          </Text>
        )}
        <View className="mt-2">
          <StatusLine post={post} />
        </View>
        <View className="mt-2 flex-row items-center gap-1.5">
          <Ionicons name="calendar-outline" size={13} color={t.textFaint} />
          <Text className="flex-1 font-sans text-xs text-zinc-500" numberOfLines={2}>
            Posted on: {formatDateTime(post.publishedAt ?? post.createdAt)}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push(`/posts/${post._id}` as never)}
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

function CountBadge({
  pending,
  count,
}: {
  pending: boolean;
  count: number | null;
}) {
  if (pending || count == null) {
    return <Skeleton className="h-6 w-8 rounded-full" />;
  }
  return (
    <View className="h-6 min-w-6 items-center justify-center rounded-full bg-surface-overlay px-1.5">
      <Text className="font-sans-bold text-xs text-zinc-300">{count}</Text>
    </View>
  );
}

function SectionError({
  title,
  hint,
  onRetry,
}: {
  title: string;
  hint: string;
  onRetry: () => void;
}) {
  return (
    <View className="items-center rounded-card border border-surface-border bg-surface-raised px-5 py-8">
      <Text className="mb-1 text-center font-sans-semibold text-base text-zinc-300">{title}</Text>
      <Text className="mb-4 text-center font-sans text-sm text-zinc-500">{hint}</Text>
      <PrimaryButton title="Try again" onPress={onRetry} />
    </View>
  );
}

/**
 * Posts tab: upcoming (every scheduled post for this business) + manual "+"
 * create + published history. Counts stay hidden until that query has
 * actually resolved. Automatic weekly posts show up here once they are
 * scheduled, then under Recent after Google confirms them.
 */
export function PostsTab() {
  const { activeBusinessId } = useBusiness();
  const router = useRouter();
  const t = useTheme();
  const { width } = useWindowDimensions();
  const upcomingCardWidth = Math.min(280, Math.max(220, width - 72));
  useRefreshContentOnFocus();

  const upcomingQuery = useInfiniteQuery({
    queryKey: ['scheduled-posts', activeBusinessId],
    queryFn: ({ pageParam }) => fetchUpcomingPosts(activeBusinessId!, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length + 1 : undefined),
    enabled: !!activeBusinessId,
    ...POST_QUERY_OPTIONS,
  });

  const recent = useInfiniteQuery({
    queryKey: ['published-posts', activeBusinessId],
    queryFn: ({ pageParam }) => fetchPublishedPosts(activeBusinessId!, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length + 1 : undefined),
    enabled: !!activeBusinessId,
    ...POST_QUERY_OPTIONS,
  });

  const upcoming = upcomingQuery.data?.pages.flatMap((p) => p.posts) ?? [];
  const upcomingTotal = upcomingQuery.data?.pages[0]?.total;
  const recentPosts = recent.data?.pages.flatMap((p) => p.posts) ?? [];
  const recentTotal = recent.data?.pages[0]?.total;

  return (
    <View className="px-4">
      <View className="flex-row items-center justify-between pt-2">
        <View className="flex-row items-center gap-2">
          <Text className="font-display-bold text-lg text-white">Upcoming Posts</Text>
          <CountBadge pending={upcomingQuery.isPending} count={upcomingQuery.isSuccess ? (upcomingTotal ?? upcoming.length) : null} />
        </View>
        <Pressable
          onPress={() => router.push('/posts/create' as never)}
          accessibilityLabel="Create post"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="add-circle" size={28} color={t.brandBright} />
        </Pressable>
      </View>

      <View className="mt-4">
        {upcomingQuery.isPending ? (
          <Skeleton className="h-64 rounded-card" />
        ) : upcomingQuery.isError ? (
          <SectionError
            title="Couldn't load upcoming posts"
            hint={getApiErrorMessage(upcomingQuery.error, 'Pull down to try again.')}
            onRetry={() => void upcomingQuery.refetch()}
          />
        ) : upcoming.length === 0 ? (
          <View className="items-center rounded-card border border-surface-border bg-surface-raised px-5 py-8">
            <Text className="mb-1 font-sans-semibold text-base text-zinc-300">No posts scheduled</Text>
            <Text className="text-center font-sans text-sm text-zinc-500">
              Your weekly posts are generated automatically — 4 posts every week from your SEO plan, business
              information, keywords, offers and relevant festivals. Tap + to write one yourself.
            </Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="pr-1">
            {upcoming.map((post) => (
              <UpcomingPostCard key={post._id} post={post} width={upcomingCardWidth} />
            ))}
          </ScrollView>
        )}
        {upcomingQuery.hasNextPage && upcomingQuery.isSuccess && (
          <Pressable
            onPress={() => void upcomingQuery.fetchNextPage()}
            disabled={upcomingQuery.isFetchingNextPage}
            style={{ alignItems: 'center', paddingVertical: 12 }}
          >
            <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
              {upcomingQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Text>
          </Pressable>
        )}
      </View>

      <View className="mt-8 flex-row items-center gap-2">
        <Text className="font-display-bold text-lg text-white">Recent Posts</Text>
        <CountBadge pending={recent.isPending} count={recent.isSuccess ? (recentTotal ?? recentPosts.length) : null} />
      </View>
      <View className="mt-3">
        {recent.isPending ? (
          <>
            <Skeleton className="mb-3 h-64 rounded-card" />
            <Skeleton className="h-64 rounded-card" />
          </>
        ) : recent.isError ? (
          <SectionError
            title="Couldn't load recent posts"
            hint={getApiErrorMessage(recent.error, 'Pull down to try again.')}
            onRetry={() => void recent.refetch()}
          />
        ) : recentPosts.length === 0 ? (
          <View className="items-center rounded-card border border-surface-border bg-surface-raised px-5 py-8">
            <Text className="mb-1 font-sans-semibold text-base text-zinc-300">No recent posts</Text>
            <Text className="mb-4 text-center font-sans text-sm text-zinc-500">
              You haven&apos;t published any posts yet.
            </Text>
            <PrimaryButton title="Create Post" onPress={() => router.push('/posts/create' as never)} />
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
    </View>
  );
}
