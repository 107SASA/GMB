import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Review from '@/models/Review';
import Business from '@/models/Business';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    // Test reviews (source 'mock') are not counted. A review is replied when
    // the owner's reply text was read from Google OR we posted one — the
    // same rule the rest of the app uses.
    const real = { source: { $ne: 'mock' } };
    const noReplyText = { $or: [{ response: { $exists: false } }, { response: null }, { response: '' }] };

    const [
      totalReviews,
      unansweredCount,
      repliedCount,
      criticalCount,
      ratingBreakdownRaw,
      recentReviewsRaw,
      avgRatingAgg,
    ] = await Promise.all([
      Review.countDocuments(real),
      Review.countDocuments({ ...real, replyStatus: { $ne: 'POSTED' }, ...noReplyText }),
      Review.countDocuments({ ...real, $or: [{ replyStatus: 'POSTED' }, { response: { $exists: true, $nin: [null, ''] } }] }),
      Review.countDocuments({ ...real, rating: { $lte: 2 } }),

      Review.aggregate([
        { $match: real },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),

      // Newest by when the customer posted it on Google — createdAt is only
      // when we first synced it.
      Review.find(real)
        .sort({ postedAt: -1, createdAt: -1 })
        .limit(20)
        .select('businessId reviewer rating reviewText response replyStatus postedAt createdAt')
        .lean(),

      Review.aggregate([
        { $match: real },
        { $group: { _id: null, avg: { $avg: '$rating' } } },
      ]),
    ]);

    // Populate business names for recent reviews
    const businessIds = [...new Set(recentReviewsRaw.map((r: any) => r.businessId?.toString()))];
    const businesses = await Business.find({ _id: { $in: businessIds } })
      .select('name')
      .lean();
    const bizMap: Record<string, string> = {};
    // The stored field is `name` (reading `businessName` showed "Unknown" for all).
    businesses.forEach((b: any) => { bizMap[b._id.toString()] = b.name; });

    const recentReviews = recentReviewsRaw.map((r: any) => ({
      _id: r._id,
      businessName: bizMap[r.businessId?.toString()] ?? 'Unknown',
      reviewer: r.reviewer,
      rating: r.rating,
      textSnippet: (r.reviewText ?? '').slice(0, 120),
      // Replied on Google by the owner themselves counts as replied too.
      replyStatus: r.replyStatus === 'POSTED' || !r.response ? (r.replyStatus ?? 'PENDING') : 'POSTED',
      postedAt: r.postedAt ?? r.createdAt,
    }));

    // Build full 1–5 breakdown
    const countByRating: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratingBreakdownRaw.forEach((row: any) => { countByRating[row._id] = row.count; });
    const ratingBreakdown = [1, 2, 3, 4, 5].map((star) => ({
      star,
      count: countByRating[star] ?? 0,
    }));

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalReviews,
          averageRating: Math.round((avgRatingAgg[0]?.avg ?? 0) * 10) / 10,
          unansweredCount,
          repliedCount,
          criticalCount,
        },
        recentReviews,
        ratingBreakdown,
      },
    });
  } catch (error: any) {
    console.error('Reviews Monitor Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch reviews data' },
      { status: 500 }
    );
  }
}
