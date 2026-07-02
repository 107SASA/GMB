import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import Review from '@/models/Review';
import Post from '@/models/Post';
import AIUsageLog from '@/models/AIUsageLog';
import { requireBusinessContext } from '@/lib/tenant';
import mongoose from 'mongoose';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const bid = new mongoose.Types.ObjectId(ctx.businessId);

    // Resolve date range from query params
    const { searchParams } = new URL(req.url);
    const rangeParam = searchParams.get('range');
    const startParam = searchParams.get('start');
    const endParam   = searchParams.get('end');

    const now = new Date();
    let rangeStart: Date;
    let rangeEnd: Date = new Date(now);

    if (startParam && endParam) {
      rangeStart = new Date(startParam);
      rangeEnd   = new Date(endParam);
      rangeEnd.setHours(23, 59, 59, 999);
    } else {
      const days = rangeParam ? parseInt(rangeParam, 10) : 30;
      rangeStart = new Date(now);
      rangeStart.setDate(now.getDate() - days);
    }

    const rangeDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24));

    // 1. Leads — all-time conversion rate (matches CRM logic exactly) + range chart + recent
    const leadsPromise = Lead.aggregate([
      { $match: { businessId: bid } },
      {
        $facet: {
          // All-time totals — same flags CRM uses
          metrics: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                converted: {
                  $sum: {
                    $cond: [
                      {
                        $or: [
                          { $eq: ['$lifeCycleStage', 'converted'] },
                          { $eq: ['$pipelineStage', 'Converted'] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          sourceDonut: [{ $group: { _id: '$source', count: { $sum: 1 } } }],
          // Chart filtered by selected range
          leadsOverTime: [
            { $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          // Recent leads in the selected range
          recentLeads: [
            { $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
            { $sort: { createdAt: -1 } },
            { $limit: 5 },
          ],
        },
      },
    ]);

    // 2. Reviews — all-time totals
    const reviewsPromise = Review.aggregate([
      { $match: { businessId: bid } },
      {
        $facet: {
          metrics: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                avgRating: { $avg: '$rating' },
                unanswered: {
                  $sum: { $cond: [{ $eq: [{ $ifNull: ['$replyText', ''] }, ''] }, 1, 0] },
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

    // 3. Posts — total all-time published count
    const postsPromise = Post.countDocuments({ businessId: bid, status: 'published' });

    // 4. AI Activity from AIUsageLog
    const aiActivitiesPromise = AIUsageLog.find({ businessId: bid })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const [leadsRes, reviewsRes, postsPublished, aiActivities] = await Promise.all([
      leadsPromise,
      reviewsPromise,
      postsPromise,
      aiActivitiesPromise,
    ]);

    const leads   = leadsRes[0];
    const reviews = reviewsRes[0];

    const totalLeads     = leads.metrics[0]?.total     ?? 0;
    const convertedLeads = leads.metrics[0]?.converted ?? 0;
    // Same formula the CRM page uses
    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    const payload = {
      range: { start: rangeStart.toISOString(), end: rangeEnd.toISOString(), days: rangeDays },
      metrics: {
        totalLeads,
        convertedLeads,
        conversionRate,
        totalReviews:      reviews.metrics[0]?.total      ?? 0,
        avgRating:         reviews.metrics[0]?.avgRating
          ? Number(reviews.metrics[0].avgRating.toFixed(1))
          : 0,
        unansweredReviews: reviews.metrics[0]?.unanswered ?? 0,
        postsPublished,
      },
      charts: {
        leadsOverTime:     leads.leadsOverTime.map((d: any) => ({ date: d._id, leads: d.count })),
        sourceDonut:       leads.sourceDonut.map((d: any) => ({ name: d._id || 'Unknown', value: d.count })),
        starsDistribution: reviews.starsDistribution.map((d: any) => ({ star: d._id, count: d.count })),
      },
      panels: {
        recentLeads: leads.recentLeads,
        aiActivities: aiActivities.map((a: any) => ({
          promptType: a.promptType,
          status:     a.status,
          aiModel:    a.aiModel,
          tokensUsed: a.tokensUsed,
          createdAt:  a.createdAt,
        })),
      },
    };

    return NextResponse.json({ success: true, data: payload });
  } catch (error: any) {
    console.error('Dashboard Stats Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
