import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { fetchThreads, type ConversationThread } from '@/api/endpoints/inbox';
import { getApiErrorMessage } from '@/api/client';
import { useBusiness } from '@/business/BusinessContext';
import { EmptyState, Screen, ScreenTitle, Skeleton } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { useTheme } from '@/lib/theme';

function ThreadRow({ thread }: { thread: ConversationThread }) {
  const router = useRouter();
  const t = useTheme();
  const lead = thread.leadId;
  if (!lead) return null;

  const unread = thread.unreadCount > 0;

  return (
    <Pressable
      onPress={() => router.push(`/inbox/${lead._id}`)}
      // No `className` — react-native-css-interop can swallow onPress on
      // styled Pressables (see components/ui.tsx).
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: t.border,
        paddingHorizontal: 20,
        paddingVertical: 14,
      }}
    >
      {/* Avatar: initials on a tinted disc */}
      <View className="h-11 w-11 items-center justify-center rounded-full bg-indigo-400/15">
        <Text className="font-sans-bold text-base text-indigo-300">
          {lead.name.trim().charAt(0).toUpperCase() || '?'}
        </Text>
      </View>

      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text
            className={`flex-1 text-base ${unread ? 'font-sans-bold text-white' : 'font-sans-semibold text-zinc-200'}`}
            numberOfLines={1}
          >
            {lead.name}
          </Text>
          <Text className="ml-2 font-sans text-xs text-zinc-500">
            {timeAgo(thread.lastActivityAt)}
          </Text>
        </View>
        <View className="mt-0.5 flex-row items-center gap-2">
          {thread.aiEnabled && <Ionicons name="sparkles" size={12} color={t.brandBright} />}
          <Text
            className={`flex-1 font-sans text-sm ${unread ? 'text-zinc-200' : 'text-zinc-500'}`}
            numberOfLines={1}
          >
            {thread.lastMessage || 'No messages yet'}
          </Text>
          {unread && (
            <View className="min-w-5 items-center rounded-full bg-brand px-1.5 py-0.5">
              <Text className="font-sans-bold text-xs text-on-brand">{thread.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function InboxScreen() {
  const { activeBusinessId } = useBusiness();
  const t = useTheme();

  const threads = useQuery({
    queryKey: ['inbox-threads', activeBusinessId],
    queryFn: fetchThreads,
    enabled: !!activeBusinessId,
    // No websockets in this backend — keep the list reasonably fresh.
    refetchInterval: 15_000,
  });

  return (
    <Screen>
      <ScreenTitle>Inbox</ScreenTitle>
      {threads.isLoading ? (
        <View className="gap-3 px-5 pt-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </View>
      ) : threads.isError ? (
        <EmptyState
          title="Couldn't load conversations"
          hint={getApiErrorMessage(threads.error, 'Pull down to retry.')}
        />
      ) : (
        <FlatList
          data={threads.data}
          keyExtractor={(t) => t._id}
          renderItem={({ item }) => <ThreadRow thread={item} />}
          refreshControl={
            <RefreshControl
              refreshing={threads.isRefetching}
              onRefresh={() => void threads.refetch()}
              tintColor={t.brandBright}
            />
          }
          ListEmptyComponent={
            <EmptyState
              title="No conversations yet"
              hint="WhatsApp conversations with your leads will appear here."
            />
          }
          contentContainerStyle={{ flexGrow: 1 }}
        />
      )}
    </Screen>
  );
}
