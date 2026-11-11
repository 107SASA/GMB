import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import PartnerApplication from '@/models/PartnerApplication';

const STATUSES = ['pending', 'approved', 'rejected'] as const;

/** Growth Partner applications, newest first, with a count per status for the tabs. */
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const statusParam = req.nextUrl.searchParams.get('status') || 'pending';
    const status: (typeof STATUSES)[number] = (STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as (typeof STATUSES)[number])
      : 'pending';

    const [applications, counts] = await Promise.all([
      PartnerApplication.find({ status })
        .select('-ip')
        .sort({ createdAt: -1 })
        .limit(500)
        .populate('reviewedBy', 'fullName email')
        .lean(),
      PartnerApplication.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);

    const countMap: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
    counts.forEach((c: any) => { countMap[c._id] = c.n; });

    return NextResponse.json({ success: true, data: applications, counts: countMap });
  } catch (error: any) {
    console.error('[admin/growth-partners/applications] GET failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to load applications' }, { status: 500 });
  }
}
