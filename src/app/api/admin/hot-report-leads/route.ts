import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Business from '@/models/Business';
import User from '@/models/User';
import Lead from '@/models/Lead';

/** Asked for the free report this many times, or opened it this many times. */
const HOT_THRESHOLD = 2;
const LIMIT = 8;

/**
 * Super-admin overview "Hot leads": businesses whose owner asked for their
 * free report again or kept opening it — counters kept by
 * services/leads/freeReport.ts and /api/free-report/viewed.
 */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const filter = {
      isDeleted: { $ne: true },
      $or: [
        { freeReportRequestCount: { $gte: HOT_THRESHOLD } },
        { freeReportViewCount: { $gte: HOT_THRESHOLD } },
      ],
    };

    const [total, businesses] = await Promise.all([
      Business.countDocuments(filter),
      Business.aggregate([
        { $match: filter },
        {
          $addFields: {
            lastActivityAt: {
              $max: [
                { $ifNull: ['$freeReportLastRequestedAt', new Date(0)] },
                { $ifNull: ['$freeReportLastViewedAt', new Date(0)] },
              ],
            },
          },
        },
        { $sort: { lastActivityAt: -1 } },
        { $limit: LIMIT },
        {
          $project: {
            name: 1, city: 1, userId: 1, subscriptionStatus: 1, lastActivityAt: 1,
            freeReportRequestCount: 1, freeReportViewCount: 1,
          },
        },
      ]),
    ]);

    const owners: any[] = await User.find({ _id: { $in: businesses.map((b) => b.userId).filter(Boolean) } })
      .select('fullName phone')
      .lean();
    const ownerById = new Map(owners.map((u) => [String(u._id), u]));
    const phones = owners.map((u) => u.phone).filter(Boolean);
    const leads: any[] = phones.length
      ? await Lead.find({ tenantId: 'gmbboost-internal', phone: { $in: phones } }).select('phone').lean()
      : [];
    const leadByPhone = new Map(leads.map((l) => [l.phone, String(l._id)]));

    return NextResponse.json({
      success: true,
      data: {
        total,
        threshold: HOT_THRESHOLD,
        leads: businesses.map((b) => {
          const owner = ownerById.get(String(b.userId));
          return {
            businessId: String(b._id),
            businessName: b.name,
            city: b.city ?? null,
            ownerName: owner?.fullName ?? null,
            phone: owner?.phone ?? null,
            leadId: owner?.phone ? leadByPhone.get(owner.phone) ?? null : null,
            subscriptionStatus: b.subscriptionStatus ?? null,
            requests: b.freeReportRequestCount ?? 0,
            views: b.freeReportViewCount ?? 0,
            lastActivityAt: b.lastActivityAt,
          };
        }),
      },
    });
  } catch (error) {
    console.error('Admin hot report leads error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load hot leads' }, { status: 500 });
  }
}
