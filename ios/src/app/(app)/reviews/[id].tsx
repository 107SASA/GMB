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
  ReplyCheckError,
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
import { useTheme, withAlpha } from '@/lib/theme';

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
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      // No `className` on this Pressable — react-native-css-interop can
      // swallow onPress on styled Pressables (see ui.tsx PrimaryButton).
      style={{
        flex: 1,
        alignItems: 'center',
        borderRadius: 999,
        borderWidth: 1,
        paddingVertical: 12,
        borderColor: destructive ? withAlpha(t.rose, 0.25) : t.border,
        backgroundColor: destructive ? t.errorContainer : t.card,
        opacity: loading ? 0.6 : 1,
      }}
    >
      <Text
        className={`font-sans-semibold text-sm ${destructive ? 'text-on-error-container' : 'text-zinc-200'}`}
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
  /** Fact-check reasons from the latest generate / approve attempt. */
  const [checkReasons, setCheckReasons] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    if (err instanceof ReplyCheckError) {
      setError(err.message);
      setCheckReasons(err.reasons);
    } else if (err instanceof PlanLimitError) setError(err.message);
    else setError(getApiErrorMessage(err, fallback));
  };
  const reset = () => {
    setError(null);
    setNotice(null);
  };

  const generate = useMutation({
    mutationFn: () => generateReply(id, review?.replyTone || 'Professional'),
    onMutate: reset,
    onSuccess: (res) => {
      setReplyDraft(res.reply);
      setCheckReasons(res.status === 'NEEDS_REVIEW' ? res.reasons : []);
      invalidate();
    },
    onError: (err) => handleError(err, 'Failed to generate a reply.'),
  });

  const approve = useMutation({
    mutationFn: (text: string) => approveReply(id, text),
    onMutate: reset,
    onSuccess: () => {
      setCheckReasons([]);
      invalidate();
    },
    onError: (err) => handleError(err, 'Failed to approve the reply.'),
  });

  const reject = useMutation({
    mutationFn: () => rejectReply(id),
    onMutate: reset,
    onSuccess: invalidate,
    onError: (err) => handleError(err, 'Failed to reject the reply.'),
  });

  const post = useMutation({
    mutationFn: () => postReply(id),
    onMutate: reset,
    onSuccess: (res) => {
      // Only a Google-confirmed publish is "posted"; blocked means it is not on Google.
      setNotice(res.outcome === 'published' ? 'Reply posted to Google.' : res.message);
      invalidate();
    },
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
  const reasons = checkReasons ?? (review.replyStatus === 'NEEDS_REVIEW' ? review.replyValidation?.reasons ?? [] : []);
  const statusNote =
    review.replyStatus === 'FAILED' || review.replyPublishStatus === 'blocked' ? review.replyFailureReason : null;
  const draft = replyDraft ?? review.aiSuggestedReply ?? '';
  const busy = generate.isPending || approve.isPending || reject.isPending || post.isPending;

  return (
    <Screen>
      {/* Header */}
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <BackChevron />
        </Pressable>
        <View className="flex-1">
          <Text className="font-display-bold text-lg text-white" numberOfLines={1}>
            {review.reviewer}
          </Text>
          <Text className="font-sans text-xs text-zinc-500">
            {review.sourcePlatform} · {formatDateTime(review.postedAt ?? review.createdAt)}
          </Text>
        </View>
        <Badge label={status.label} tone={status.tone} />
      </View>

      <ScrollView contentContainerClassName="px-5 pb-10" keyboardShouldPersistTaps="handled">
        {/* Review */}
        <View className="mt-4 rounded-card border border-surface-border bg-surface-raised px-4 py-3.5">
          <View className="flex-row items-center gap-2">
            <Stars rating={review.rating} size={16} />
            {!!review.sentiment && (
              <Badge label={review.sentiment} tone={sentimentTone(review.sentiment)} />
            )}
          </View>
          <Text className="mt-2 font-sans text-base text-zinc-200">
            {review.reviewText || 'No review text — rating only.'}
          </Text>
        </View>

        {!!error && (
          <View className="pt-3">
            <ErrorText>{error}</ErrorText>
          </View>
        )}
        {!!(notice || statusNote) && (
          <View className="mt-3 rounded-card border border-surface-border bg-surface-raised px-4 py-3">
            <Text className="font-sans text-sm text-zinc-300">{notice || statusNote}</Text>
          </View>
        )}
        {reasons.length > 0 && review.replyStatus !== 'POSTED' && (
          <View className="mt-3 rounded-card border border-surface-border bg-surface-raised px-4 py-3">
            <Text className="mb-1 font-sans-bold text-xs uppercase tracking-wider text-zinc-500">
              Held for your review — fact check
            </Text>
            {reasons.slice(0, 5).map((r) => (
              <Text key={r} className="font-sans text-sm text-zinc-300">
                • {r}
              </Text>
            ))}
            <Text className="mt-1 font-sans text-xs text-zinc-500">
              Edit the reply to remove these, then approve. Nothing is posted until it passes.
            </Text>
          </View>
        )}

        {review.replyStatus === 'POSTED' ? (
          <>
            <Text className="mb-2 mt-6 font-sans-bold text-xs uppercase tracking-wider text-zinc-500">
              Your reply
            </Text>
            <View className="rounded-card border border-secondary/20 bg-secondary-container/40 px-4 py-3.5">
              <Text className="font-sans text-base text-zinc-200">{review.response}</Text>
            </View>
          </>
        ) : (
          <>
            <Text className="mb-2 mt-6 font-sans-bold text-xs uppercase tracking-wider text-zinc-500">
              AI-suggested reply (fact-checked)
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
              <View className="rounded-card border border-surface-border bg-surface-raised px-4 py-6">
                <Text className="text-center font-sans text-sm text-zinc-400">
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
