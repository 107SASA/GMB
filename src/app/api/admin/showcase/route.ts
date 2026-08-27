import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import dbConnect from '@/lib/mongodb';
import ShowcaseAsset from '@/models/ShowcaseAsset';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

const STATUSES = ['pending', 'approved', 'rejected'];

/** Superadmin moderation queue for client showcase uploads. ?status= filters (default: pending). */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'pending';
    const filter = STATUSES.includes(status) ? { status } : {};

    const assets = await ShowcaseAsset.find(filter)
      .populate('businessId', 'name')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return NextResponse.json({ success: true, assets });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
