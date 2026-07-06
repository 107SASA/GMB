import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  fetchMessages,
  fetchThreads,
  sendMessage,
  setThreadAiEnabled,
  type ConversationMessage,
  type ConversationThread,
} from '@/api/endpoints/inbox';
import { useBusiness } from '@/business/BusinessContext';
import {
  BackChevron, EmptyState, ErrorText, LoadingScreen, Screen
} from '@/components/ui';
import { formatTime } from '@/lib/format';
import { useTheme } from '@/lib/theme';

function MessageBubble({ message }: { message: ConversationMessage }) {
  const outbound = message.direction === 'outbound';
  return (
    <View className={`mb-2 max-w-[80%] ${outbound ? 'self-end' : 'self-start'}`}>
      <View
        className={`rounded-2xl px-3.5 py-2.5 ${
          outbound ? 'rounded-br-sm bg-brand' : 'rounded-bl-sm bg-surface-raised'
        }`}
      >
        <Text className={`text-base ${outbound ? "text-on-brand" : "text-white"}`}>{message.messageText}</Text>
      </View>
      <View className={`mt-1 flex-row items-center gap-1.5 ${outbound ? 'self-end' : 'self-start'}`}>
        {message.isAI && (
          <>
            <Ionicons name="sparkles" size={10} color="#6366F1" />
            <Text className="text-xs text-indigo-300">AI</Text>
          </>
        )}
        <Text className="text-xs text-zinc-500">{formatTime(message.timestamp)}</Text>
        {outbound && message.messageStatus === 'failed' && (
          <Text className="text-xs text-rose-300">failed</Text>
        )}
      </View>
    </View>
  );
}

export default function ThreadScreen() {
  const t = useTheme();
  const { leadId } = useLocalSearchParams<{ leadId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();

  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);

  // The thread (name, phone, threadId, aiEnabled) comes from the same query
  // the inbox list uses, so this screen works when deep-linked from Leads too.
  const threads = useQuery({
    queryKey: ['inbox-threads', activeBusinessId],
    queryFn: fetchThreads,
    enabled: !!activeBusinessId,
  });
  const thread = useMemo(
    () => threads.data?.find((t) => t.leadId?._id === leadId) ?? null,
    [threads.data, leadId]
  );
  const lead = thread?.leadId ?? null;

  const messages = useQuery({
    queryKey: ['inbox-messages', activeBusinessId, leadId],
    queryFn: () => fetchMessages(leadId),
    enabled: !!activeBusinessId && !!leadId,
    // Poll the open thread; fetching also clears unreadCount server-side.
    refetchInterval: 10_000,
  });

  const toggleAi = useMutation({
    mutationFn: (aiEnabled: boolean) => setThreadAiEnabled(thread!._id, aiEnabled),
    onMutate: async (aiEnabled) => {
      // Optimistically flip the switch in the threads cache.
      await queryClient.cancelQueries({ queryKey: ['inbox-threads', activeBusinessId] });
      const previous = queryClient.getQueryData<ConversationThread[]>([
        'inbox-threads',
        activeBusinessId,
      ]);
      queryClient.setQueryData<ConversationThread[]>(
        ['inbox-threads', activeBusinessId],
        (old) => old?.map((t) => (t._id === thread?._id ? { ...t, aiEnabled } : t))
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['inbox-threads', activeBusinessId], context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbox-threads', activeBusinessId] });
    },
  });

  const send = useMutation({
    mutationFn: (text: string) =>
      sendMessage({
        leadId,
        threadId: thread!._id,
        phone: lead!.phone!,
        text,
      }),
    onMutate: async (text) => {
      setSendError(null);
      await queryClient.cancelQueries({ queryKey: ['inbox-messages', activeBusinessId, leadId] });
      const previous = queryClient.getQueryData<ConversationMessage[]>([
        'inbox-messages',
        activeBusinessId,
        leadId,
      ]);
      const optimistic: ConversationMessage = {
        _id: `optimistic-${Date.now()}`,
        direction: 'outbound',
        messageText: text,
        isAI: false,
        messageStatus: 'sent',
        timestamp: new Date().toISOString(),
      };
      queryClient.setQueryData<ConversationMessage[]>(
        ['inbox-messages', activeBusinessId, leadId],
        (old) => [...(old ?? []), optimistic]
      );
      return { previous };
    },
    onError: (err, _text, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['inbox-messages', activeBusinessId, leadId], context.previous);
      }
      setSendError(getApiErrorMessage(err, 'Failed to send message.'));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbox-messages', activeBusinessId, leadId] });
      // Sending manually also disables AI server-side — refresh the thread row.
      void queryClient.invalidateQueries({ queryKey: ['inbox-threads', activeBusinessId] });
    },
  });

  function handleSend() {
    const text = draft.trim();
    if (!text || !thread || !lead?.phone || send.isPending) return;
    setDraft('');
    send.mutate(text);
  }

  if (threads.isLoading || messages.isLoading) return <LoadingScreen />;

  if (!thread || !lead) {
    return (
      <Screen>
        <EmptyState
          title="Conversation not found"
          hint={getApiErrorMessage(
            threads.error,
            'This lead has no WhatsApp conversation yet.'
          )}
        />
      </Screen>
    );
  }

  // Newest at the bottom via an inverted list (keeps scroll pinned to the end).
  const inverted = [...(messages.data ?? [])].reverse();

  return (
    <Screen>
      {/* Header */}
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
        <Pressable onPress={() => router.back()} hitSlop={8} className="active:opacity-60">
          <BackChevron />
        </Pressable>
        <View className="flex-1">
          <Text className="text-base font-semibold text-white" numberOfLines={1}>
            {lead.name}
          </Text>
          {!!lead.phone && <Text className="text-xs text-zinc-500">{lead.phone}</Text>}
        </View>
        <View className="items-end">
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="sparkles" size={12} color={thread.aiEnabled ? '#6366F1' : '#666E94'} />
            <Text className="text-xs text-zinc-400">AI agent</Text>
          </View>
          <Switch
            value={thread.aiEnabled}
            onValueChange={(v) => toggleAi.mutate(v)}
            disabled={toggleAi.isPending}
            trackColor={{ false: t.border, true: t.brand }}
            thumbColor="#ffffff"
          />
        </View>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          data={inverted}
          inverted
          keyExtractor={(m) => m._id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, flexGrow: 1 }}
          ListEmptyComponent={
            // Inverted list flips children — un-flip the empty state.
            <View style={{ transform: [{ scaleY: -1 }] }} className="flex-1">
              <EmptyState title="No messages yet" hint="Send the first message below." />
            </View>
          }
        />

        {/* Composer */}
        <View className="border-t border-surface-border px-4 pb-2 pt-2">
          {!!sendError && (
            <View className="pb-1">
              <ErrorText>{sendError}</ErrorText>
            </View>
          )}
          {lead.phone ? (
            <View className="flex-row items-end gap-2">
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Type a message"
                placeholderTextColor="#666E94"
                multiline
                className="max-h-28 flex-1 rounded-2xl border border-surface-border bg-surface-raised px-4 py-2.5 text-base text-white"
              />
              <Pressable
                onPress={handleSend}
                disabled={!draft.trim() || send.isPending}
                className={`h-11 w-11 items-center justify-center rounded-full ${
                  draft.trim() && !send.isPending ? 'bg-brand active:opacity-80' : 'bg-surface-raised'
                }`}
              >
                <Ionicons
                  name="send"
                  size={18}
                  color={draft.trim() && !send.isPending ? '#ffffff' : '#666E94'}
                />
              </Pressable>
            </View>
          ) : (
            <Text className="py-2 text-center text-sm text-zinc-500">
              This lead has no phone number, so messages can't be sent.
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
