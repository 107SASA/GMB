import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';

export interface ReviewMetrics {
  totalReviews: number;
  avgRating: number;
  unansweredCount: number;
  responseRate: number;
  sentimentScore: number;
  positiveReviews: number;
  negativeReviews: number;
  criticalReviews: number;
  starsDistribution: { star: number; count: number }[];
}

/**
 * The single source of truth for every review statistic shown anywhere in the app
 * (Review Management cards, Dashboard cards/charts, and the analytics snapshot written
 * after a Google sync). Previously this same set of numbers was computed three separate
 * ways — a Mongo aggregation in /api/dashboard/stats, a client-side JS reduce in
 * ReviewsDashboard.tsx, and another Mongo aggregation in syncReviewsForBusiness — each
 * with its own slightly different definition of "unanswered" / "sentiment score". That's
 * exactly the kind of duplicate business logic that lets the Dashboard and Review
 * Management module drift apart. Everything now calls this one function against the
 * one Review collection, so a given business always has exactly one true set of numbers
 * regardless of which page reads them or when.
 */
export async function computeReviewMetrics(businessId: string): Promise<ReviewMetrics> {
  await dbConnect();
  const bid = new mongoose.Types.ObjectId(businessId);

  const [result] = await Review.aggregate([
    { $match: { businessId: bid } },
    {
      $facet: {
        metrics: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              avgRating: { $avg: '$rating' },
              // "Unanswered" means not yet posted back to Google — replyStatus is the
              // authoritative field for that (a drafted-but-unapproved AI reply doesn't count).
              unanswered: { $sum: { $cond: [{ $ne: ['$replyStatus', 'POSTED'] }, 1, 0] } },
              positive: {
                $sum: { $cond: [{ $or: [{ $eq: ['$sentiment', 'positive'] }, { $gte: ['$rating', 4] }] }, 1, 0] },
              },
              negative: {
                $sum: {
                  $cond: [{ $or: [{ $eq: ['$sentiment', 'negative'] }, { $eq: ['$sentiment', 'critical'] }] }, 1, 0],
                },
              },
              critical: {
                $sum: { $cond: [{ $or: [{ $eq: ['$sentiment', 'critical'] }, { $lte: ['$rating', 2] }] }, 1, 0] },
              },
            },
          },
        ],
        starsDistribution: [
          { $group: { _id: '$rating', count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ]);

  const m = result?.metrics?.[0];
  const total = m?.total ?? 0;
  const unanswered = m?.unanswered ?? 0;

  return {
    totalReviews: total,
    avgRating: m?.avgRating ? Number(m.avgRating.toFixed(1)) : 0,
    unansweredCount: unanswered,
    responseRate: total > 0 ? Math.round(((total - unanswered) / total) * 100) : 0,
    sentimentScore: total > 0 ? Math.round(((m?.positive ?? 0) / total) * 100) : 0,
    positiveReviews: m?.positive ?? 0,
    negativeReviews: m?.negative ?? 0,
    criticalReviews: m?.critical ?? 0,
    starsDistribution: (result?.starsDistribution ?? []).map((d: any) => ({ star: d._id, count: d.count })),
  };
}
