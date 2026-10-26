import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import type { ContentPost } from '@/api/endpoints/content';
import { updatePost } from '@/api/endpoints/scheduler';
import { useBusiness } from '@/business/BusinessContext';
import { BottomSheet, Field, PrimaryButton, SecondaryButton, useInfoSheet } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * Modal form for editing a scheduled/draft post's title/content — shared by
 * the Posts tab's list and the post-detail screen (extracted from
 * posts-tab.tsx, which previously defined this locally and was the only
 * place that could open it).
 */
export function EditPostModal({ post, onClose }: { post: ContentPost; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content);
  const info = useInfoSheet();
  const t = useTheme();

  const save = useMutation({
    mutationFn: () => updatePost(post._id, { title: title.trim(), content: content.trim() }, activeBusinessId ?? undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer', activeBusinessId] });
      void queryClient.invalidateQueries({ queryKey: ['post', activeBusinessId, post._id] });
      void queryClient.invalidateQueries({ queryKey: ['published-posts', activeBusinessId] });
      void queryClient.invalidateQueries({ queryKey: ['scheduled-posts', activeBusinessId] });
      onClose();
    },
    onError: (error) =>
      info.show('Could not save', getApiErrorMessage(error, 'Please try again.')),
  });

  return (
    <>
    <BottomSheet visible onClose={onClose}>
        <Text className="mb-4 font-display-bold text-lg" style={{ color: t.text }}>Edit Post</Text>
        <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">Title</Text>
        <Field value={title} onChangeText={setTitle} placeholder="Post title" />
        <Text className="mb-1.5 mt-3 px-1 font-sans-semibold text-xs text-zinc-400">Content</Text>
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
    </BottomSheet>
    {info.node}
    </>
  );
}
