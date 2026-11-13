import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { requireCrmModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/leads/business-card/events — the "Where you met" values already
 * used in this workspace (from saved visiting-card leads), most recently used
 * first, with how many cards each has. Feeds the event picker in the app so
 * owners pick instead of retyping, on any phone in the team.
 */
export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireCrmModule(ctx.userId, ctx.businessId);
    if (!gate.ok) return gate.response;

    await dbConnect();
    const rows = await Lead.aggregate([
      {
        $match: {
          businessId: new mongoose.Types.ObjectId(ctx.businessId),
          'businessCard.metAt': { $type: 'string', $ne: '' },
        },
      },
      {
        $group: {
          _id: '$businessCard.metAt',
          count: { $sum: 1 },
          lastUsedAt: { $max: { $ifNull: ['$businessCard.scannedAt', '$createdAt'] } },
        },
      },
      { $sort: { lastUsedAt: -1 } },
      { $limit: 50 },
    ]);

    return NextResponse.json({
      success: true,
      events: rows.map((r) => ({ name: String(r._id), count: r.count, lastUsedAt: r.lastUsedAt ?? null })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
