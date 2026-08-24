import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import Notification from '@/models/Notification';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Resolves the caller's active workspace, verifying ownership, WITHOUT
 * hard-failing when no workspace is selected yet (e.g. mid-onboarding) —
 * unlike requireBusinessContext(), a missing/unresolvable business here just
 * means "scope to account-level notifications only", not a 400/403.
 */
async function resolveActiveBusinessId(
  userId: string,
  organizationId: string | undefined,
  role: string
): Promise<string | null> {
  const cookieStore = await cookies();
  const businessId = cookieStore.get('activeBusinessId')?.value;
  if (!businessId) return null;

  await dbConnect();
  let business;
  if (role === 'SUPER_ADMIN') {
    business = await Business.findById(businessId).select('_id').lean();
  } else {
    const ownershipConditions: any[] = [{ userId }];
    if (organizationId) ownershipConditions.push({ organizationId });
    business = await Business.findOne({ _id: businessId, $or: ownershipConditions })
      .select('_id')
      .lean();
  }
  return business ? businessId : null;
}

/** Latest notifications for the signed-in user + unread count, scoped to the active workspace. */
export async function GET(req: Request) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '15')));

    const businessId = await resolveActiveBusinessId(
      auth.userId,
      (auth.user as any).organizationId?.toString(),
      (auth.user as any).role
    );

    // Account-level notifications (no businessId) always show; business-level
    // ones are scoped to the active workspace only — never another one.
    const scope = businessId
      ? { userId: auth.userId, $or: [{ businessId }, { businessId: { $exists: false } }] }
      : { userId: auth.userId, businessId: { $exists: false } };

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(scope).sort({ createdAt: -1 }).limit(limit).lean(),
      Notification.countDocuments({ ...scope, read: false }),
    ]);

    return NextResponse.json({ success: true, notifications, unreadCount });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

/** Mark all (or one, with { id }) of the user's notifications as read, scoped to the active workspace. */
export async function PATCH(req: Request) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const body = await req.json().catch(() => ({}));

    const businessId = await resolveActiveBusinessId(
      auth.userId,
      (auth.user as any).organizationId?.toString(),
      (auth.user as any).role
    );

    const scope: any = businessId
      ? { userId: auth.userId, $or: [{ businessId }, { businessId: { $exists: false } }] }
      : { userId: auth.userId, businessId: { $exists: false } };

    const query: any = { ...scope, read: false };
    if (body.id) query._id = body.id;

    await Notification.updateMany(query, { read: true });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
