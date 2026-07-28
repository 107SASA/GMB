import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '@/api/endpoints/notifications';
import { EmptyState, Screen, ScreenTitle, Skeleton } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { useTheme } from '@/lib/theme';

/**
 * Best-effort mapping from the web dashboard paths stored on notifications
 * (e.g. /dashboard/reviews) to the equivalent mobile route. Unrecognized
 * links just mark the notification read without navigating anywhere.
 */
const LINK_MAP: Record<string, string> = {
  reviews: '/reviews',
  content: '/content',
  billing: '/billing',
  scheduler: '/scheduler',
  leads: '/leads',
  settings: '/settings',
  inbox: '/inbox',
  'gbp-profile': '/gbp',
  whatsapp: '/whatsapp',
};

function mobileRouteFor(link?: string | null): string | null {
  if (!link) return null;
  const segment = link.replace(/^\/dashboard\/?/, '').split('/')[0];
  return LINK_MAP[segment] ?? null;
}

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  critical_review: 'alert-circle',
  review_received: 'star',
  reply_drafted: 'chatbubble-ellipses',
};

function NotificationRow({
  item,
  onPress,
}: {
  item: AppNotification;
  onPress: (item: AppNotification) => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onPress(item)}
      className={`mb-2.5 flex-row gap-3 rounded-xl border px-4 py-3.5 active:opacity-80 ${
        item.read
          ? 'border-surface-border bg-surface-raised'
          : 'border-brand/40 bg-brand/10'
      }`}
    >
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-overlay">
        <Ionicons name={TYPE_ICON[item.type] ?? 'notifications-outline'} size={17} color={t.brandBright} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-sm font-semibold text-white" numberOfLines={1}>
            {item.title}
          </Text>
          {!item.read && <View className="h-2 w-2 rounded-full bg-brand" />}
        </View>
        {!!item.body && (
          <Text className="mt-0.5 text-xs leading-4 text-zinc-400" numberOfLines={2}>
            {item.body}
          </Text>
        )}
        <Text className="mt-1 text-[11px] text-zinc-500">{timeAgo(item.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const t = useTheme();
  const queryClient = useQueryClient();

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications(),
  });

  const markOne = useMutation({ mutationFn: markNotificationRead });
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) => console.warn(getApiErrorMessage(err, 'Could not mark all read.')),
  });

  function handlePress(item: AppNotification) {
    if (!item.read) {
      markOne.mutate(item._id, {
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      });
    }
    const route = mobileRouteFor(item.link);
    if (route) router.push(route as any);
  }

  const unread = notifications.data?.unreadCount ?? 0;

  return (
    <Screen>
      <View className="flex-row items-center justify-between px-5 pb-2 pt-4">
        <ScreenTitle>Notifications</ScreenTitle>
        {unread > 0 && (
          <Pressable onPress={() => markAll.mutate()} disabled={markAll.isPending} className="pb-2">
            <Text className="text-sm font-semibold" style={{ color: t.brandBright }}>
              {markAll.isPending ? 'Marking…' : 'Mark all read'}
            </Text>
          </Pressable>
        )}
      </View>

      {notifications.isLoading ? (
        <View className="gap-2.5 px-5">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </View>
      ) : notifications.isError ? (
        <EmptyState
          title="Couldn't load notifications"
          hint={getApiErrorMessage(notifications.error, 'Pull down to retry.')}
        />
      ) : (
        <FlatList
          data={notifications.data?.notifications ?? []}
          keyExtractor={(n) => n._id}
          renderItem={({ item }) => <NotificationRow item={item} onPress={handlePress} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={notifications.isRefetching}
              onRefresh={() => void notifications.refetch()}
              tintColor="#6366F1"
            />
          }
          ListEmptyComponent={
            <EmptyState title="No notifications yet" hint="Updates about your business will show up here." />
          }
        />
      )}
    </Screen>
  );
}
