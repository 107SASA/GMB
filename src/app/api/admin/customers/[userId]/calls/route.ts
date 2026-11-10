import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import User from '@/models/User';
import Business from '@/models/Business';
import CustomerCallLog, { CALL_OUTCOMES } from '@/models/CustomerCallLog';
import { primaryBusinessByOwner } from '@/lib/admin/realAccounts';

/** POST /api/admin/customers/[userId]/calls — log a follow-up call. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const { userId } = await params;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return NextResponse.json({ success: false, error: 'Invalid customer id' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const outcome = body?.outcome;
  if (!(CALL_OUTCOMES as readonly string[]).includes(outcome)) {
    return NextResponse.json({ success: false, error: 'Pick a call outcome' }, { status: 400 });
  }
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : undefined;
  let followUpAt: Date | undefined;
  if (body?.followUpAt) {
    const d = new Date(body.followUpAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ success: false, error: 'Invalid follow-up date' }, { status: 400 });
    }
    followUpAt = d;
  }

  try {
    await dbConnect();
    const user = await User.findById(userId).select('role').lean() as any;
    if (!user || user.role === 'SUPER_ADMIN') {
      return NextResponse.json({ success: false, error: 'Customer not found' }, { status: 404 });
    }
    const businesses = await Business.find({ userId, isDeleted: { $ne: true } }).select('userId subscriptionStatus').lean();
    const biz = primaryBusinessByOwner(businesses as any[])[userId] as any;

    const admin = auth.user as any;
    const row = await CustomerCallLog.create({
      userId,
      businessId: biz?._id,
      adminUserId: auth.userId,
      adminName: admin?.fullName || admin?.email,
      outcome,
      note: note || undefined,
      followUpAt,
    });

    return NextResponse.json({
      success: true,
      data: {
        _id: String(row._id),
        at: row.createdAt,
        outcome: row.outcome,
        note: row.note,
        followUpAt: row.followUpAt ?? null,
        adminName: row.adminName,
      },
    });
  } catch (error: any) {
    console.error('[admin/customers/calls] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to save call' }, { status: 500 });
  }
}
