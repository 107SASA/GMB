import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  fetchReplySettings,
  REPLY_TONES,
  saveReplySettings,
  type ReplyMode,
  type ReplySettings,
} from '@/api/endpoints/reviews';
import { useBusiness } from '@/business/BusinessContext';
import {
  Chip,
  EmptyState,
  PrimaryButton,
  Screen,
  ScreenTitle,
  SectionLabel,
  Skeleton,
  useInfoSheet,
} from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * Review settings — the app's counterpart of the web Review Management
 * reply-mode toggle (src/components/reviews/ReplyModeSettings.tsx), saving
 * the same per-workspace setting. Auto-reply is the default.
 */

const MODES: { mode: ReplyMode; title: string; body: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  {
    mode: 'auto',
    title: 'Auto-reply to all reviews',
    body: 'Replies that pass the fact check are posted without waiting for you. Replies that fail it are kept as drafts for your review. Also covers your existing unanswered reviews. (Default)',
    icon: 'sparkles',
  },
  {
    mode: 'manual',
    title: 'AI drafts, I approve',
    body: 'The AI drafts a fact-checked reply for each new review. Nothing posts to Google until you approve it and tap Post.',
    icon: 'person-circle',
  },
];

function ModeCard({ item, selected, onPress }: { item: (typeof MODES)[number]; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      // No `className` — react-native-css-interop can swallow onPress on
      // styled Pressables (see components/ui.tsx PrimaryButton).
      style={{
        borderRadius: 16,
        borderWidth: 2,
        borderColor: selected ? t.brand : t.border,
        backgroundColor: t.card,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <View className="mb-1 flex-row items-center gap-2">
        <Ionicons name={item.icon} size={17} color={selected ? t.brand : t.textDim} />
        <Text className="flex-1 font-sans-bold text-base text-white">{item.title}</Text>
        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? t.brand : t.textFaint} />
      </View>
      <Text className="font-sans text-sm text-zinc-400">{item.body}</Text>
    </Pressable>
  );
}

function ReplySettingsForm({ initial }: { initial: ReplySettings }) {
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const [mode, setMode] = useState<ReplyMode>(initial.mode);
  const [tone, setTone] = useState(initial.tone);
  const info = useInfoSheet();

  const save = useMutation({
    mutationFn: () => saveReplySettings({ mode, tone }),
    onSuccess: ({ queued }) => {
      info.show(
        'Saved',
        mode === 'auto' && queued > 0
          ? `${queued} existing review${queued === 1 ? '' : 's'} queued. Replies that pass the fact check will be posted; the rest wait for you.`
          : mode === 'auto'
            ? 'Fact-checked replies to new reviews will be posted automatically; anything that fails the check waits for you.'
            : "You'll review and approve every AI reply from now on."
      );
      void queryClient.invalidateQueries({ queryKey: ['review-reply-settings', activeBusinessId] });
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
    onError: (err) => info.show('Error', getApiErrorMessage(err, 'Could not save.')),
  });

  const unchanged = mode === initial.mode && tone === initial.tone;

  return (
    <View>
      <SectionLabel>How should review replies work?</SectionLabel>
      {MODES.map((item) => (
        <ModeCard key={item.mode} item={item} selected={mode === item.mode} onPress={() => setMode(item.mode)} />
      ))}

      {mode === 'auto' && (
        <>
          <SectionLabel>Reply tone</SectionLabel>
          <View className="mb-2 flex-row flex-wrap gap-2">
            {REPLY_TONES.map((t) => (
              <Chip key={t} label={t} selected={tone === t} onPress={() => setTone(t)} />
            ))}
          </View>
        </>
      )}

      <View className="mt-5">
        <PrimaryButton title="Save" onPress={() => save.mutate()} loading={save.isPending} disabled={unchanged} />
      </View>
      {info.node}
    </View>
  );
}

export default function ReviewSettingsScreen() {
  const { activeBusinessId } = useBusiness();
  const settings = useQuery({
    queryKey: ['review-reply-settings', activeBusinessId],
    queryFn: fetchReplySettings,
    enabled: !!activeBusinessId,
  });

  return (
    <Screen>
      <ScreenTitle>Review settings</ScreenTitle>
      <ScrollView contentContainerClassName="px-4 pb-16">
        <Text className="px-1 font-sans text-sm text-zinc-400">
          Choose per workspace — you can switch this anytime. The same setting is shown on the website.
        </Text>
        {settings.isLoading ? (
          <Skeleton className="mt-7 h-64" />
        ) : settings.isError || !settings.data ? (
          <EmptyState title="Couldn't load review settings" hint={getApiErrorMessage(settings.error, 'Try again.')} />
        ) : (
          <ReplySettingsForm key={settings.dataUpdatedAt} initial={settings.data} />
        )}
      </ScrollView>
    </Screen>
  );
}
