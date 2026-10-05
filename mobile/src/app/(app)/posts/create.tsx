import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { createPost } from '@/api/endpoints/content';
import { publishPost, schedulePost } from '@/api/endpoints/scheduler';
import { useBusiness } from '@/business/BusinessContext';
import { useDateTimePicker } from '@/components/datetime-picker';
import { Field, PrimaryButton, Screen, useInfoSheet } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/**
 * Manual Google Business Profile post — the "+" on the Posts tab.
 * Creates a draft via POST /api/posts, then either publishes through
 * /api/scheduler/publish or schedules through /api/scheduler/schedule.
 * The image is geotagged on the server from the verified business location.
 * This screen does not read the phone's current GPS.
 */
export default function CreatePostScreen() {
  const router = useRouter();
  const t = useTheme();
  const queryClient = useQueryClient();
  const picker = useDateTimePicker();
  const { activeBusinessId } = useBusiness();
  const info = useInfoSheet();

  const [content, setContent] = useState('');
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [image, setImage] = useState<{ uri: string; base64: string; mime: string } | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);

  const refreshLists = () => {
    if (!activeBusinessId) return;
    void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer', activeBusinessId] });
    void queryClient.invalidateQueries({ queryKey: ['published-posts', activeBusinessId] });
    void queryClient.invalidateQueries({ queryKey: ['scheduled-posts', activeBusinessId] });
    void queryClient.invalidateQueries({ queryKey: ['scheduled-posts-count', activeBusinessId] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusinessId] });
    void queryClient.invalidateQueries({ queryKey: ['content-posts', activeBusinessId] });
  };

  const ensureDraft = async () => {
    if (!activeBusinessId) throw new Error('Choose a business first.');
    if (draftId) return draftId;
    const text = content.trim();
    const post = await createPost(activeBusinessId, {
      title: text.slice(0, 80),
      content: text,
      imageBase64: image?.base64,
      imageMime: image?.mime,
    });
    setDraftId(post._id);
    return post._id;
  };

  const publish = useMutation({
    mutationFn: async () => {
      const id = await ensureDraft();
      return publishPost(id, activeBusinessId!);
    },
    onSuccess: (res) => {
      refreshLists();
      if (res.outcome === 'blocked') {
        info.show('Not sent to Google', res.message);
        return;
      }
      router.back();
    },
    onError: (error) => info.show('Could not publish', getApiErrorMessage(error, 'Please try again.')),
  });

  const schedule = useMutation({
    mutationFn: async (date: Date) => {
      const id = await ensureDraft();
      await schedulePost(id, date, activeBusinessId!);
    },
    onSuccess: () => {
      refreshLists();
      router.back();
    },
    onError: (error) => info.show('Could not schedule', getApiErrorMessage(error, 'Please try again.')),
  });

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      info.show('Photos permission needed', 'Allow photo access to attach an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
      exif: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) {
      info.show('Could not read that image', 'Try a different photo.');
      return;
    }
    const mime = asset.mimeType && asset.mimeType.startsWith('image/') ? asset.mimeType : 'image/jpeg';
    setImage({ uri: asset.uri, base64: asset.base64, mime });
    setDraftId(null);
  };

  const busy = publish.isPending || schedule.isPending;
  const canSubmit = !!content.trim() && !!activeBusinessId && !busy;

  return (
    <Screen>
      <View className="flex-row items-center gap-3 px-4 pb-3 pt-4">
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={t.text} />
        </Pressable>
        <Text className="flex-1 font-display-bold text-lg" style={{ color: t.text }} numberOfLines={1}>
          New Post
        </Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerClassName="px-4 pb-16"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text className="mb-1.5 px-1 font-sans-semibold text-xs text-zinc-400">Post</Text>
        <Field
          value={content}
          onChangeText={(value) => {
            setContent(value);
            setDraftId(null);
          }}
          placeholder="Write your Google Business Profile post…"
          multiline
          numberOfLines={8}
          textAlignVertical="top"
          className="min-h-40"
        />

        <Text className="mb-1.5 mt-4 px-1 font-sans-semibold text-xs text-zinc-400">Image</Text>
        {image ? (
          <View className="overflow-hidden rounded-card border border-surface-border">
            <Image source={{ uri: image.uri }} style={{ width: '100%', height: 200 }} contentFit="cover" />
            <Pressable
              onPress={() => {
                setImage(null);
                setDraftId(null);
              }}
              style={{ position: 'absolute', right: 10, top: 10 }}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={26} color="#ffffff" />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => void pickImage()}
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: t.border,
              backgroundColor: t.card,
              paddingVertical: 28,
            }}
          >
            <Ionicons name="image-outline" size={22} color={t.textFaint} />
            <Text className="font-sans text-sm text-zinc-400">Choose an image</Text>
          </Pressable>
        )}

        <Text className="mb-2 mt-5 px-1 font-sans-semibold text-xs text-zinc-400">Preview</Text>
        <View className="overflow-hidden rounded-card border border-surface-border bg-surface-raised">
          {image && <Image source={{ uri: image.uri }} style={{ width: '100%', height: 160 }} contentFit="cover" />}
          <View className="p-4">
            <Text className="font-sans text-sm leading-5 text-zinc-200">
              {content.trim() || 'Your post text will appear here.'}
            </Text>
            {scheduledDate && (
              <Text className="mt-2 font-sans text-xs text-zinc-500">
                Scheduled for {formatDateTime(scheduledDate.toISOString())}
              </Text>
            )}
          </View>
        </View>

        <Text className="mb-1.5 mt-4 px-1 font-sans-semibold text-xs text-zinc-400">Schedule</Text>
        <Pressable
          onPress={() => picker.open(scheduledDate ?? new Date(Date.now() + 60 * 60 * 1000), setScheduledDate)}
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
            {scheduledDate ? formatDateTime(scheduledDate.toISOString()) : 'Pick a date and time'}
          </Text>
          {scheduledDate && (
            <Pressable onPress={() => setScheduledDate(null)} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={t.textFaint} />
            </Pressable>
          )}
        </Pressable>

        <View className="mt-6 gap-3">
          <PrimaryButton title="Publish now" onPress={() => publish.mutate()} loading={publish.isPending} disabled={!canSubmit} />
          <PrimaryButton
            title="Schedule post"
            onPress={() => {
              if (scheduledDate) {
                schedule.mutate(scheduledDate);
                return;
              }
              picker.open(new Date(Date.now() + 60 * 60 * 1000), (date) => {
                setScheduledDate(date);
                schedule.mutate(date);
              });
            }}
            loading={schedule.isPending}
            disabled={!canSubmit}
          />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
      {picker.element}
      {info.node}
    </Screen>
  );
}
