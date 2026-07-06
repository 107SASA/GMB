import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchReviews, type Review } from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import { replyStatusBadge, sentimentTone, Stars } from '@/components/review-bits';
import { Badge, Chip, EmptyState, Screen, ScreenTitle, Skeleton } from '@/components/ui';
import { timeAgo } from '@/lib/format';

type Filter = 'all' | 'needs-reply' | 'replied';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'needs-reply', label: 'Needs reply' },
  { id: 'replied', label: 'Replied' },
];

function ReviewCard({ review }: { review: Review }) {
  const router = useRouter();
  const status = replyStatusBadge(review.replyStatus);
  return (
    <Pressable
      onPress={() => router.push(`/reviews/${review._id}`)}
      className="mb-3 rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5 active:opacity-80"
    >
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-base font-semibold text-white" numberOfLines={1}>
          {review.reviewer}
        </Text>
        <Text className="text-xs text-zinc-500">{timeAgo(review.postedAt ?? review.createdAt)}</Text>
      </View>
      <View className="mt-1.5 flex-row items-center gap-2">
        <Stars rating={review.rating} />
        {!!review.sentiment && (
          <Badge label={review.sentiment} tone={sentimentTone(review.sentiment)} />
        )}
        <View className="ml-auto">
          <Badge label={status.label} tone={status.tone} />
        </View>
      </View>
      {!!review.reviewText && (
        <Text className="mt-2 text-sm text-zinc-400" numberOfLines={2}>
          {review.reviewText}
        </Text>
      )}
    </Pressable>
  );
}

export default function ReviewsScreen() {
  const { activeBusinessId } = useBusiness();
  const [filter, setFilter] = useState<Filter>('all');

  const reviews = useQuery({
    queryKey: ['reviews', activeBusinessId],
    queryFn: fetchReviews,
    enabled: !!activeBusinessId,
  });

  // Same semantics as the web dashboard: replied = POSTED, everything else
  // still needs attention.
  const filtered = useMemo(() => {
    return (reviews.data ?? []).filter((r) => {
      if (filter === 'needs-reply') return r.replyStatus !== 'POSTED';
      if (filter === 'replied') return r.replyStatus === 'POSTED';
      return true;
    });
  }, [reviews.data, filter]);

  return (
    <Screen>
      <ScreenTitle>Reviews</ScreenTitle>

      <View className="pb-3">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2 px-5"
        >
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              label={f.label}
              selected={filter === f.id}
              onPress={() => setFilter(f.id)}
            />
          ))}
        </ScrollView>
      </View>

      {reviews.isLoading ? (
        <View className="gap-3 px-5">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </View>
      ) : reviews.isError ? (
        <EmptyState
          title="Couldn't load reviews"
          hint={getApiErrorMessage(reviews.error, 'Pull down to retry.')}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r._id}
          renderItem={({ item }) => <ReviewCard review={item} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={reviews.isRefetching}
              onRefresh={() => void reviews.refetch()}
              tintColor="#6366F1"
            />
          }
          ListEmptyComponent={
            <EmptyState
              title={filter === 'all' ? 'No reviews yet' : 'Nothing here'}
              hint={
                filter === 'all'
                  ? 'Reviews synced from your Google Business Profile will appear here.'
                  : 'Try a different filter.'
              }
            />
          }
        />
      )}
    </Screen>
  );
}
