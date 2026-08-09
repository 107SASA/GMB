import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { createPost } from '@/api/endpoints/content';
import { useBusiness } from '@/business/BusinessContext';
import { useDateTimePicker } from '@/components/datetime-picker';
import { Field, PrimaryButton, Screen } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/**
 * Manual "write your own post" screen — the "+" on the Posts tab.
 * POST /api/posts already existed on the backend (Post.create, no AI
 * involvement) but had no caller anywhere, web or mobile, before this —
 * see the status-default bug fixed in that route's file. This is genuinely
 * new UI for real, already-supported backend capability, not a port of an
 * existing web form (the web's own /dashboard/posts/create just redirects
 * to the AI content generator — there's no manual form there either).
 */
export default function CreatePostScreen() {
  const router = useRouter();
  const t = useTheme();
  const queryClient = useQueryClient();
  const picker = useDateTimePicker();
  const { activeBusinessId } = useBusiness();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createPost({
        title: title.trim(),
        content: content.trim(),
        scheduledDate: scheduledDate?.toISOString(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer', activeBusinessId] });
      void queryClient.invalidateQueries({ queryKey: ['published-posts', activeBusinessId] });
      router.back();
    },
    onError: (error) =>
      Alert.alert('Could not create post', getApiErrorMessage(error, 'Please try again.')),
  });

  return (
    <Screen>
      <View className="flex-row items-center gap-3 px-4 pb-3 pt-4">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={t.text} />
        </Pressable>
        <Text className="font-display-bold text-lg text-white">New Post</Text>
      </View>

      <ScrollView contentContainerClassName="px-4 pb-10" keyboardShouldPersistTaps="handled">
        <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">Title</Text>
        <Field value={title} onChangeText={setTitle} placeholder="What's this post about?" />

        <Text className="mb-1.5 mt-4 px-1 font-sans-semibold text-xs text-zinc-400">Content</Text>
        <Field
          value={content}
          onChangeText={setContent}
          placeholder="Write your post…"
          multiline
          numberOfLines={8}
          textAlignVertical="top"
          className="min-h-40"
        />

        <Text className="mb-1.5 mt-4 px-1 font-sans-semibold text-xs text-zinc-400">
          Schedule (optional)
        </Text>
        <Pressable
          onPress={() => picker.open(scheduledDate ?? new Date(), setScheduledDate)}
          // No `className` — react-native-css-interop can swallow onPress on
          // styled Pressables (see components/ui.tsx).
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.card,
            paddingHorizontal: 16,
            paddingVertical: 14,
          }}
        >
          <Ionicons name="calendar-outline" size={16} color={t.textFaint} />
          <Text className="flex-1 font-sans text-sm text-zinc-300">
            {scheduledDate ? formatDateTime(scheduledDate.toISOString()) : 'Save as draft (no date picked)'}
          </Text>
          {scheduledDate && (
            <Pressable onPress={() => setScheduledDate(null)} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={t.textFaint} />
            </Pressable>
          )}
        </Pressable>

        <View className="mt-6">
          <PrimaryButton
            title={scheduledDate ? 'Schedule Post' : 'Save as Draft'}
            onPress={() => create.mutate()}
            loading={create.isPending}
            disabled={!title.trim() || !content.trim()}
          />
        </View>
      </ScrollView>
      {picker.element}
    </Screen>
  );
}
