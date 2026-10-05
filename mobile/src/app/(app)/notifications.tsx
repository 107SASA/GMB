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
import { useAuth } from '@/auth/AuthContext';
import { EmptyState, PrimaryButton, Screen, Skeleton, useInfoSheet } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { useTheme, withAlpha } from '@/lib/theme';

/**
 * Best-effort mapping from the web dashboard paths stored on notifications
 * (e.g. /dashboard/reviews) to the equivalent mobile route. Unrecognized
 * links just mark the notification read without navigating anywhere.
 *
 * "inbox" and "whatsapp" are marked superAdminOnly because their route
 * groups (`(app)/inbox/_layout.tsx`, `(app)/whatsapp/_layout.tsx`) redirect
 * any non-SUPER_ADMIN straight to /more — without this gate, a regular
 * business-owner tapping one of these notifications (in-app or a push
 * notification) got silently bounced to /more with no explanation, which
 * just looks like the notification is broken. Keep this list in sync with
 * more.tsx's own `superAdminOnly` menu items if either changes.
 */
const LINK_MAP: Record<string, { route: string; superAdminOnly?: boolean }> = {
  reviews: { route: '/reviews' },
  content: { route: '/content' },
  billing: { route: '/billing' },
  scheduler: { route: '/scheduler' },
  leads: { route: '/leads' },
  // Customer CRM (web link /dashboard/crm): follow-up due, unsaved callers.
  crm: { route: '/leads' },
  settings: { route: '/settings' },
  inbox: { route: '/inbox', superAdminOnly: true },
  'gbp-profile': { route: '/gbp' },
  whatsapp: { route: '/whatsapp', superAdminOnly: true },
  // Weekly engine (Sep 2026): offer question / festival prompts link to the dashboard,
  // review nudges to review requests (reviews screen here), monthly reports to the audit.
  '': { route: '/dashboard' },
  'review-requests': { route: '/reviews' },
  posts: { route: '/posts' },
  audit: { route: '/audit' },
};

function mobileRouteFor(link: string | null | undefined, isSuperAdmin: boolean): string | null {
  if (!link) return null;
  const [rawPath, query = ''] = link.replace(/^\/dashboard\/?/, '').split('?');
  const path = rawPath;
  const [segment, id] = path.split('/');
  const entry = LINK_MAP[segment];
  if (!entry) return null;
  if (entry.superAdminOnly && !isSuperAdmin) return null;
  // /dashboard/crm/growth-report?month=YYYY-MM → the Monthly Growth Report.
  if (segment === 'crm' && id === 'growth-report') {
    const m = query.match(/(?:^|&)month=([0-9]{4}-[0-9]{2}|current)/)?.[1];
    return m ? `/leads/growth-report?month=${m}` : '/leads/growth-report';
  }
  // /dashboard/crm?calls=1 → the calls list (Save as Lead / Existing / Dismiss).
  if (segment === 'crm' && /(^|&)calls=1(&|$)/.test(query)) return '/leads/recent-calls';
  // /dashboard/audit/<id> → the report itself.
  if (segment === 'audit' && id) return `/audit/${id}`;
  return entry.route;
}

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  crm_follow_up_due: 'alarm-outline',
  crm_follow_up_overdue: 'alarm-outline',
  crm_growth_report_ready: 'stats-chart-outline',
  crm_incoming_call: 'call-outline',
  crm_missed_call: 'call-outline',
  critical_review: 'alert-circle',
  review_received: 'star',
  reply_drafted: 'chatbubble-ellipses',
  festival_prompt: 'sparkles',
  weekly_offer_question: 'pricetag',
  weekly_no_new_reviews: 'star-outline',
  content_draft: 'document-text-outline',
  post_failed: 'alert-circle-outline',
  post_published: 'checkmark-circle-outline',
  monthly_report: 'bar-chart-outline',
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
      // No `className` — react-native-css-interop can swallow onPress on
      // styled Pressables (see components/ui.tsx).
      style={{
        marginBottom: 10,
        flexDirection: 'row',
        gap: 12,
        borderRadius: 20,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderColor: item.read ? t.border : withAlpha(t.brand, 0.4),
        backgroundColor: item.read ? t.card : withAlpha(t.brand, 0.1),
      }}
    >
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-overlay">
        <Ionicons name={TYPE_ICON[item.type] ?? 'notifications-outline'} size={17} color={t.brandBright} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View className="flex-row items-start justify-between gap-2">
          <Text className="flex-1 font-sans-semibold text-sm" style={{ color: t.text }}>
            {item.title}
          </Text>
          {!item.read && (
            <View className="mt-1.5 h-2 w-2 rounded-full bg-brand" accessibilityLabel="Unread" />
          )}
        </View>
        {!!item.body && (
          <Text className="mt-0.5 font-sans text-xs leading-4" style={{ color: t.textDim }}>
            {item.body}
          </Text>
        )}
        <Text className="mt-1 font-sans text-[11px]" style={{ color: t.textFaint }}>{timeAgo(item.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const t = useTheme();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const info = useInfoSheet();

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications(),
  });

  const markOne = useMutation({ mutationFn: markNotificationRead });
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) =>
      info.show('Could not mark all read', getApiErrorMessage(err, 'Please try again.')),
  });

  function handlePress(item: AppNotification) {
    if (!item.read) {
      markOne.mutate(item._id, {
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      });
    }
    const route = mobileRouteFor(item.link, isSuperAdmin);
    if (route) router.push(route as any);
  }

  const unread = notifications.data?.unreadCount ?? 0;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Text className="flex-1 font-display" style={{ color: t.text, fontSize: 24, lineHeight: 30 }} numberOfLines={1}>
          Notifications
        </Text>
        {unread > 0 && !notifications.isLoading && (
          <Pressable
            onPress={() => markAll.mutate()}
            disabled={markAll.isPending}
            accessibilityLabel="Mark all read"
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}
          >
            <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>
              {markAll.isPending ? 'Marking…' : 'Mark all read'}
            </Text>
          </Pressable>
        )}
      </View>

      {notifications.isLoading ? (
        <View className="gap-2.5 px-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </View>
      ) : notifications.isError ? (
        <EmptyState
          title="Couldn't load notifications"
          hint={getApiErrorMessage(notifications.error, 'Something went wrong. Please try again.')}
          action={<PrimaryButton title="Retry" onPress={() => void notifications.refetch()} />}
        />
      ) : (
        <FlatList
          data={notifications.data?.notifications ?? []}
          keyExtractor={(n) => n._id}
          renderItem={({ item }) => <NotificationRow item={item} onPress={handlePress} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={notifications.isRefetching}
              onRefresh={() => void notifications.refetch()}
              tintColor={t.brandBright}
            />
          }
          ListEmptyComponent={
            <EmptyState title="No notifications yet" hint="Updates about your business will show up here." />
          }
        />
      )}
      {info.node}
    </Screen>
  );
}
