import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  autoSchedulePosts,
  fetchContentPosts,
  generateContent,
  type ContentPost,
  type GeneratedPost,
  type GenerateResult,
} from '@/api/endpoints/content';
import { PlanLimitError } from '@/api/endpoints/reviews';
import { deletePost, schedulePost, updatePost } from '@/api/endpoints/scheduler';
import { useBusiness } from '@/business/BusinessContext';
import { useDateTimePicker } from '@/components/datetime-picker';
import {
  Badge,
  Chip,
  EmptyState,
  ErrorText,
  Field,
  LabeledField,
  PrimaryButton,
  Screen,
  ScreenTitle,
  SectionLabel,
  SegmentedControl,
  Skeleton,
} from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { formatDateTime } from '@/lib/format';

const TONES = ['Professional', 'Friendly', 'Motivational', 'Luxury', 'Conversational'];
const CONTENT_TYPES = ['GMB Posts', 'SEO Description', 'FAQs', 'Promotional Posts', 'Festival Posts'];

// --- Generate segment ---------------------------------------------------------

function GeneratedPostCard({ post }: { post: GeneratedPost }) {
  return (
    <View className="mb-3 rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5">
      {!!post.title && <Text className="text-base font-semibold text-white">{post.title}</Text>}
      <Text className="mt-1.5 text-sm leading-5 text-zinc-300">{post.body}</Text>
      {post.hashtags.length > 0 && (
        <Text className="mt-2 text-xs text-indigo-300">{post.hashtags.join(' ')}</Text>
      )}
      {!!post.cta && <Text className="mt-1 text-xs text-zinc-500">CTA: {post.cta}</Text>}
    </View>
  );
}

function GenerateSegment() {
  const t = useTheme();
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();

  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('Professional');
  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>(['GMB Posts', 'SEO Description', 'FAQs']);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);

  const generate = useMutation({
    mutationFn: () =>
      generateContent({
        tone,
        keywords,
        contentTypes: types,
        topic: topic.trim() || undefined,
      }),
    onSuccess: (data) => {
      setResult(data);
      // Drafts were saved server-side — history is now stale.
      void queryClient.invalidateQueries({ queryKey: ['content-posts', activeBusinessId] });
    },
    onError: (err) => {
      setError(
        err instanceof PlanLimitError
          ? err.message
          : getApiErrorMessage(err, 'Generation failed. Try again.')
      );
    },
  });

  const autoSchedule = useMutation({
    mutationFn: (postIds: string[]) => autoSchedulePosts(postIds),
    onSuccess: ({ count }) => {
      Alert.alert('Scheduled', `${count} post${count === 1 ? '' : 's'} scheduled, one per day at 9 AM.`);
      void queryClient.invalidateQueries({ queryKey: ['content-posts', activeBusinessId] });
      void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer', activeBusinessId] });
    },
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not schedule the posts.')),
  });

  function addKeyword() {
    const value = keywordInput.trim();
    if (!value || keywords.includes(value)) return;
    setKeywords([...keywords, value]);
    setKeywordInput('');
  }

  const schedulableIds = (result?.posts ?? [])
    .filter((p): p is GeneratedPost => p !== null && !!p._id)
    .map((p) => p._id as string);

  return (
    <ScrollView contentContainerClassName="px-5 pb-12" keyboardShouldPersistTaps="handled">
      <LabeledField
        label="Topic or theme (optional)"
        value={topic}
        onChangeText={setTopic}
        placeholder="e.g. Summer Sale, Diwali Offers…"
      />

      <Text className="mb-1.5 px-1 text-xs font-medium text-zinc-400">Tone</Text>
      <View className="mb-3 flex-row flex-wrap gap-2">
        {TONES.map((t) => (
          <Chip key={t} label={t} selected={tone === t} onPress={() => setTone(t)} />
        ))}
      </View>

      <Text className="mb-1.5 px-1 text-xs font-medium text-zinc-400">Target keywords</Text>
      <View className="mb-2 flex-row gap-2">
        <View className="flex-1">
          <Field
            value={keywordInput}
            onChangeText={setKeywordInput}
            placeholder="Add a keyword"
            onSubmitEditing={addKeyword}
            returnKeyType="done"
          />
        </View>
        <Pressable
          onPress={addKeyword}
          className="items-center justify-center rounded-xl border border-surface-border bg-surface-raised px-4 active:opacity-80"
        >
          <Ionicons name="add" size={20} color={t.text} />
        </Pressable>
      </View>
      {keywords.length > 0 && (
        <View className="mb-3 flex-row flex-wrap gap-2">
          {keywords.map((k) => (
            <Chip
              key={k}
              label={`${k} ×`}
              selected
              onPress={() => setKeywords(keywords.filter((x) => x !== k))}
            />
          ))}
        </View>
      )}

      <Text className="mb-1.5 px-1 text-xs font-medium text-zinc-400">What to generate</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {CONTENT_TYPES.map((t) => (
          <Chip
            key={t}
            label={t}
            selected={types.includes(t)}
            onPress={() =>
              setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t])
            }
          />
        ))}
      </View>

      {!!error && (
        <View className="mb-3">
          <ErrorText>{error}</ErrorText>
        </View>
      )}

      <PrimaryButton
        title={generate.isPending ? 'Generating…' : 'Generate content'}
        onPress={() => {
          setError('');
          setResult(null);
          generate.mutate();
        }}
        loading={generate.isPending}
        disabled={types.length === 0}
      />
      {generate.isPending && (
        <Text className="mt-2 text-center text-xs text-zinc-500">
          This takes 30–60 seconds. Keep the app open.
        </Text>
      )}

      {result && (
        <View>
          {result.posts.length > 0 && (
            <View>
              <View className="flex-row items-center justify-between">
                <SectionLabel>Generated posts</SectionLabel>
                {schedulableIds.length > 0 && (
                  <Pressable
                    onPress={() => autoSchedule.mutate(schedulableIds)}
                    disabled={autoSchedule.isPending}
                    className="mt-4 flex-row items-center gap-1 rounded-full bg-brand px-3 py-1.5 active:opacity-80"
                  >
                    {autoSchedule.isPending ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Ionicons name="calendar-outline" size={13} color="#ffffff" />
                    )}
                    <Text className="text-xs font-semibold text-on-brand">Auto-schedule all</Text>
                  </Pressable>
                )}
              </View>
              {result.posts
                .filter((p): p is GeneratedPost => p !== null)
                .map((post, i) => (
                  <GeneratedPostCard key={post._id ?? i} post={post} />
                ))}
            </View>
          )}

          {!!result.seoDescription && (
            <View>
              <SectionLabel>SEO description</SectionLabel>
              <View className="rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5">
                <Text className="text-sm leading-5 text-zinc-300">{result.seoDescription}</Text>
                {result.seoScore !== null && (
                  <Text className="mt-2 text-xs text-zinc-500">SEO score: {result.seoScore}</Text>
                )}
              </View>
            </View>
          )}

          {result.faqs.length > 0 && (
            <View>
              <SectionLabel>FAQs</SectionLabel>
              <View className="gap-2">
                {result.faqs
                  .filter((f): f is NonNullable<typeof f> => f !== null)
                  .map((faq, i) => (
                    <View
                      key={i}
                      className="rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5"
                    >
                      <Text className="text-sm font-semibold text-white">{faq.question}</Text>
                      <Text className="mt-1 text-sm leading-5 text-zinc-400">{faq.answer}</Text>
                    </View>
                  ))}
              </View>
            </View>
          )}
        </View>
      )}
    </ScrollView>
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
  const status = postStatusBadge(post);
  const published = post.status === 'published';
  return (
    <View className="mb-3 rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-base font-semibold text-white" numberOfLines={1}>
          {post.title || 'Untitled post'}
        </Text>
        <Badge label={status.label} tone={status.tone} />
      </View>
      <Text className="mt-1.5 text-sm text-zinc-400" numberOfLines={3}>
        {post.content}
      </Text>
      {!!post.scheduledDate && !published && (
        <Text className="mt-1.5 text-xs text-zinc-500">
          Scheduled for {formatDateTime(post.scheduledDate)}
        </Text>
      )}
      {!published && (
        <View className="mt-3 flex-row gap-2">
          <Pressable
            onPress={onSchedule}
            className="flex-row items-center gap-1 rounded-full border border-surface-border px-3 py-1.5 active:opacity-70"
          >
            <Ionicons name="calendar-outline" size={13} color="#8B93B8" />
            <Text className="text-xs font-medium text-zinc-300">Schedule</Text>
          </Pressable>
          <Pressable
            onPress={onEdit}
            className="flex-row items-center gap-1 rounded-full border border-surface-border px-3 py-1.5 active:opacity-70"
          >
            <Ionicons name="pencil-outline" size={13} color="#8B93B8" />
            <Text className="text-xs font-medium text-zinc-300">Edit</Text>
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

  const save = useMutation({
    mutationFn: () => updatePost(post._id, { title, content }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not save the post.')),
  });

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="max-h-[85%] rounded-t-2xl border-t border-surface-border bg-surface px-5 pb-8 pt-4">
          <Text className="mb-3 text-lg font-bold text-white">Edit post</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <LabeledField label="Title" value={title} onChangeText={setTitle} />
            <Text className="mb-1.5 px-1 text-xs font-medium text-zinc-400">Content</Text>
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
            <Pressable onPress={onClose} className="mt-3 items-center py-2 active:opacity-70">
              <Text className="text-sm text-zinc-400">Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function HistorySegment() {
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const picker = useDateTimePicker();
  const [editing, setEditing] = useState<ContentPost | null>(null);

  const history = useInfiniteQuery({
    queryKey: ['content-posts', activeBusinessId],
    queryFn: ({ pageParam }) => fetchContentPosts(pageParam),
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
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not schedule the post.')),
  });

  const remove = useMutation({
    mutationFn: (postId: string) => deletePost(postId),
    onSuccess: invalidate,
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not delete the post.')),
  });

  const posts = history.data?.pages.flatMap((page) => page.posts) ?? [];

  function confirmDelete(post: ContentPost) {
    Alert.alert('Delete post?', 'This removes the draft permanently.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(post._id) },
    ]);
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
            <ActivityIndicator color="#6366F1" style={{ paddingVertical: 12 }} />
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            title="No content yet"
            hint="Posts you generate will show up here as drafts you can schedule."
          />
        }
      />
      {picker.element}
      {editing && (
        <EditPostModal post={editing} onClose={() => setEditing(null)} onSaved={invalidate} />
      )}
    </>
  );
}

// --- Screen ---------------------------------------------------------------------

export default function ContentScreen() {
  const [segment, setSegment] = useState<'generate' | 'history'>('generate');

  return (
    <Screen>
      <ScreenTitle>Content Generator</ScreenTitle>
      <SegmentedControl
        segments={[
          { id: 'generate', label: 'Generate' },
          { id: 'history', label: 'History' },
        ]}
        value={segment}
        onChange={setSegment}
      />
      {segment === 'generate' ? <GenerateSegment /> : <HistorySegment />}
    </Screen>
  );
}
