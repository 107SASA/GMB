import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Notification from '@/models/Notification';
import { requireClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Latest notifications for the signed-in user + unread count. */
export async function GET(req: Request) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '15')));

    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ userId: auth.userId }).sort({ createdAt: -1 }).limit(limit).lean(),
      Notification.countDocuments({ userId: auth.userId, read: false }),
    ]);

    return NextResponse.json({ success: true, notifications, unreadCount });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

/** Mark all (or one, with { id }) of the user's notifications as read. */
export async function PATCH(req: Request) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const body = await req.json().catch(() => ({}));

    const query: any = { userId: auth.userId, read: false };
    if (body.id) query._id = body.id;

    await Notification.updateMany(query, { read: true });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
