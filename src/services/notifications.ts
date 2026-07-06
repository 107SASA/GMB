import dbConnect from '@/lib/mongodb';
import Notification from '@/models/Notification';
import User from '@/models/User';
import Business from '@/models/Business';

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  link?: string;
}

/**
 * Creates an in-app dashboard notification for every user allowed to act on
 * a business — the same ownership rules as sendPushToBusinessUsers in
 * services/push.ts (owner, users whose businessIds contain it, org members).
 * Best-effort: callers must never fail their workflow on a notification error.
 */
export async function notifyBusinessUsers(businessId: string, input: NotificationInput): Promise<void> {
  try {
    await dbConnect();
    const business = await Business.findById(businessId)
      .select('userId organizationId')
      .lean() as any;
    if (!business) return;

    const ownership: any[] = [{ businessIds: businessId }];
    if (business.userId) ownership.push({ _id: business.userId });
    if (business.organizationId) ownership.push({ organizationId: business.organizationId });

    const users = await User.find({ $or: ownership, isDeleted: { $ne: true } })
      .select('_id')
      .lean() as any[];
    if (users.length === 0) return;

    await Notification.insertMany(
      users.map((u) => ({
        userId: u._id,
        businessId,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link,
        read: false,
      }))
    );
  } catch (e: any) {
    console.error('[notifications] Failed to create notifications:', e.message);
  }
}
