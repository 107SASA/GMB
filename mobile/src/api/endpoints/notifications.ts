import { z } from 'zod';
import { api } from '../client';

/**
 * In-app notification center — mirrors src/models/Notification.ts and
 * src/app/api/notifications/route.ts on the web. User-scoped (no
 * x-business-id needed): the same feed a user sees regardless of which
 * workspace is active.
 */

export const appNotificationSchema = z.object({
  _id: z.string(),
  type: z.string().catch('info'),
  title: z.string().catch('Notification'),
  body: z.string().catch(''),
  link: z.string().nullable().optional(),
  read: z.boolean().catch(false),
  createdAt: z.string(),
});
export type AppNotification = z.infer<typeof appNotificationSchema>;

const listResponseSchema = z.object({
  success: z.literal(true),
  notifications: z.array(appNotificationSchema.nullable().catch(null)),
  unreadCount: z.number().catch(0),
});

/** GET /api/notifications — latest notifications + unread count. */
export async function fetchNotifications(
  limit = 30
): Promise<{ notifications: AppNotification[]; unreadCount: number }> {
  const { data } = await api.get('/api/notifications', { params: { limit } });
  const parsed = listResponseSchema.parse(data);
  return {
    notifications: parsed.notifications.filter((n): n is AppNotification => n !== null),
    unreadCount: parsed.unreadCount,
  };
}

/** PATCH /api/notifications — marks one notification read. */
export async function markNotificationRead(id: string): Promise<void> {
  await api.patch('/api/notifications', { id });
}

/** PATCH /api/notifications — marks every unread notification read. */
export async function markAllNotificationsRead(): Promise<void> {
  await api.patch('/api/notifications', {});
}
