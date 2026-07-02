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

    const [
      totalReviews,
      unansweredCount,
      repliedCount,
      criticalCount,
      ratingBreakdownRaw,
      recentReviewsRaw,
      avgRatingAgg,
    ] = await Promise.all([
      Review.countDocuments(),
      Review.countDocuments({ $or: [{ response: null }, { response: '' }] }),
      Review.countDocuments({ response: { $exists: true, $ne: '' } }),
      Review.countDocuments({ rating: { $lte: 2 } }),

      Review.aggregate([
        { $group: { _id: '$rating', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),

      Review.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .select('businessId reviewer rating reviewText replyStatus createdAt')
        .lean(),

      Review.aggregate([
        { $group: { _id: null, avg: { $avg: '$rating' } } },
      ]),
    ]);

    // Populate business names for recent reviews
    const businessIds = [...new Set(recentReviewsRaw.map((r: any) => r.businessId?.toString()))];
    const businesses = await Business.find({ _id: { $in: businessIds } })
      .select('businessName')
      .lean();
    const bizMap: Record<string, string> = {};
    businesses.forEach((b: any) => { bizMap[b._id.toString()] = b.businessName; });

    const recentReviews = recentReviewsRaw.map((r: any) => ({
      _id: r._id,
      businessName: bizMap[r.businessId?.toString()] ?? 'Unknown',
      reviewer: r.reviewer,
      rating: r.rating,
      textSnippet: (r.reviewText ?? '').slice(0, 120),
      replyStatus: r.replyStatus ?? 'PENDING',
      postedAt: r.createdAt,
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
