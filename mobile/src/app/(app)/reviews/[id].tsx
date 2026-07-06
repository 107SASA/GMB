import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  approveReply,
  fetchReviews,
  generateReply,
  postReply,
  rejectReply,
  PlanLimitError,
  type Review,
} from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import { replyStatusBadge, sentimentTone, Stars } from '@/components/review-bits';
import {
  BackChevron,
  Badge,
  EmptyState,
  ErrorText,
  Field,
  LoadingScreen,
  PrimaryButton,
  Screen,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';

function SecondaryButton({
  title,
  onPress,
  loading = false,
  destructive = false,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      className={`flex-1 items-center rounded-xl border py-3 active:opacity-70 ${
        destructive ? 'border-rose-400/25 bg-rose-400/10' : 'border-surface-border bg-surface-raised'
      } ${loading ? 'opacity-60' : ''}`}
    >
      <Text
        className={`text-sm font-semibold ${destructive ? 'text-rose-300' : 'text-zinc-200'}`}
      >
        {loading ? '…' : title}
      </Text>
    </Pressable>
  );
}

export default function ReviewDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();

  const [replyDraft, setReplyDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reviews = useQuery({
    queryKey: ['reviews', activeBusinessId],
    queryFn: fetchReviews,
    enabled: !!activeBusinessId,
  });
  const review = useMemo(
    () => reviews.data?.find((r) => r._id === id) ?? null,
    [reviews.data, id]
  );

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['reviews', activeBusinessId] });

  const handleError = (err: unknown, fallback: string) => {
    if (err instanceof PlanLimitError) setError(err.message);
    else setError(getApiErrorMessage(err, fallback));
  };

  const generate = useMutation({
    mutationFn: () => generateReply(id, review?.replyTone || 'Professional'),
    onMutate: () => setError(null),
    onSuccess: (reply) => {
      setReplyDraft(reply);
      invalidate();
    },
    onError: (err) => handleError(err, 'Failed to generate a reply.'),
  });

  const approve = useMutation({
    mutationFn: (text: string) => approveReply(id, text),
    onMutate: () => setError(null),
    onSuccess: invalidate,
    onError: (err) => handleError(err, 'Failed to approve the reply.'),
  });

  const reject = useMutation({
    mutationFn: () => rejectReply(id),
    onMutate: () => setError(null),
    onSuccess: invalidate,
    onError: (err) => handleError(err, 'Failed to reject the reply.'),
  });

  const post = useMutation({
    mutationFn: () => postReply(id),
    onMutate: () => setError(null),
    onSuccess: invalidate,
    onError: (err) => handleError(err, 'Failed to post the reply.'),
  });

  if (reviews.isLoading) return <LoadingScreen />;

  if (!review) {
    return (
      <Screen>
        <EmptyState
          title="Review not found"
          hint={getApiErrorMessage(reviews.error, 'It may have been removed.')}
        />
      </Screen>
    );
  }

  const status = replyStatusBadge(review.replyStatus);
  const draft = replyDraft ?? review.aiSuggestedReply ?? '';
  const busy = generate.isPending || approve.isPending || reject.isPending || post.isPending;

  return (
    <Screen>
      {/* Header */}
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
        <Pressable onPress={() => router.back()} hitSlop={8} className="active:opacity-60">
          <BackChevron />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-bold text-white" numberOfLines={1}>
            {review.reviewer}
          </Text>
          <Text className="text-xs text-zinc-500">
            {review.sourcePlatform} · {formatDateTime(review.postedAt ?? review.createdAt)}
          </Text>
        </View>
        <Badge label={status.label} tone={status.tone} />
      </View>

      <ScrollView contentContainerClassName="px-5 pb-10" keyboardShouldPersistTaps="handled">
        {/* Review */}
        <View className="mt-4 rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5">
          <View className="flex-row items-center gap-2">
            <Stars rating={review.rating} size={16} />
            {!!review.sentiment && (
              <Badge label={review.sentiment} tone={sentimentTone(review.sentiment)} />
            )}
          </View>
          <Text className="mt-2 text-base text-zinc-200">
            {review.reviewText || 'No review text — rating only.'}
          </Text>
        </View>

        {!!error && (
          <View className="pt-3">
            <ErrorText>{error}</ErrorText>
          </View>
        )}

        {review.replyStatus === 'POSTED' ? (
          <>
            <Text className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Your reply
            </Text>
            <View className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3.5">
              <Text className="text-base text-zinc-200">{review.response}</Text>
            </View>
          </>
        ) : (
          <>
            <Text className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              AI-suggested reply
            </Text>

            {draft ? (
              <Field
                value={draft}
                onChangeText={setReplyDraft}
                multiline
                className="min-h-28"
                textAlignVertical="top"
                editable={!busy}
              />
            ) : (
              <View className="rounded-xl border border-surface-border bg-surface-raised px-4 py-6">
                <Text className="text-center text-sm text-zinc-400">
                  No suggestion yet. Generate one to get started.
                </Text>
              </View>
            )}

            <View className="mt-3 gap-3">
              {!draft && (
                <PrimaryButton
                  title="Generate suggestion"
                  loading={generate.isPending}
                  onPress={() => generate.mutate()}
                />
              )}

              {!!draft && review.replyStatus !== 'APPROVED' && (
                <PrimaryButton
                  title="Approve reply"
                  loading={approve.isPending}
                  onPress={() => approve.mutate(draft.trim())}
                  disabled={!draft.trim() || busy}
                />
              )}

              {review.replyStatus === 'APPROVED' && (
                <PrimaryButton
                  title="Post reply to Google"
                  loading={post.isPending}
                  onPress={() => post.mutate()}
                  disabled={busy}
                />
              )}

              {!!draft && (
                <View className="flex-row gap-3">
                  {review.replyStatus === 'APPROVED' && (
                    <SecondaryButton
                      title="Re-approve edits"
                      loading={approve.isPending}
                      onPress={() => approve.mutate(draft.trim())}
                    />
                  )}
                  <SecondaryButton
                    title="Regenerate"
                    loading={generate.isPending}
                    onPress={() => generate.mutate()}
                  />
                  {review.replyStatus !== 'REJECTED' && (
                    <SecondaryButton
                      title="Reject"
                      destructive
                      loading={reject.isPending}
                      onPress={() => reject.mutate()}
                    />
                  )}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
