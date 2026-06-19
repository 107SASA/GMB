import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import Review from '@/models/Review';
import Post from '@/models/Post';
import Activity from '@/models/Activity';
import { requireBusinessContext } from '@/lib/tenant';
import mongoose from 'mongoose';

export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const bid = new mongoose.Types.ObjectId(ctx.businessId);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const next7Days = new Date();
    next7Days.setDate(today.getDate() + 7);

    // 1. Leads Aggregation
    const leadsPromise = Lead.aggregate([
      { $match: { businessId: bid } },
      {
        $facet: {
          metrics: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                converted: { $sum: { $cond: [{ $eq: ['$pipelineStage', 'Converted'] }, 1, 0] } },
              },
            },
          ],
          sourceDonut: [{ $group: { _id: '$source', count: { $sum: 1 } } }],
          leadsOverTime: [
            { $match: { createdAt: { $gte: thirtyDaysAgo } } },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          recentLeads: [{ $sort: { createdAt: -1 } }, { $limit: 5 }],
        },
      },
    ]);

    // 2. Reviews Aggregation
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

    // 3. Posts (Scheduler) Aggregation
    const postsPromise = Post.aggregate([
      { $match: { businessId: bid } },
      {
        $facet: {
          metrics: [
            {
              $group: {
                _id: null,
                published: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } },
                scheduled: { $sum: { $cond: [{ $eq: ['$status', 'scheduled'] }, 1, 0] } },
              },
            },
          ],
          calendar: [
            { $match: { scheduledAt: { $gte: today, $lte: next7Days } } },
            { $sort: { scheduledAt: 1 } },
          ],
          lastScheduledPost: [
            { $match: { status: 'scheduled' } },
            { $sort: { scheduledAt: -1 } },
            { $limit: 1 },
          ],
        },
      },
    ]);

    // 4. Active leads needing attention
    const followUpsPromise = Lead.find({
      businessId: bid,
      pipelineStage: { $in: ['New', 'Contacted', 'Qualified'] },
    })
      .sort({ lastInteractionTime: 1 })
      .limit(5)
      .lean();

    // 5. Activity Feed
    const activityPromise = Activity.find({ businessId: bid })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate('leadId', 'name')
      .lean();

    const [leadsRes, reviewsRes, postsRes, followUps, activities] = await Promise.all([
      leadsPromise,
      reviewsPromise,
      postsPromise,
      followUpsPromise,
      activityPromise,
    ]);

    const leads = leadsRes[0];
    const reviews = reviewsRes[0];
    const posts = postsRes[0];

    let bufferDays = 0;
    if (posts.lastScheduledPost.length > 0) {
      const lastDate = new Date(posts.lastScheduledPost[0].scheduledAt);
      bufferDays = Math.max(0, Math.ceil((lastDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
    }

    const payload = {
      metrics: {
        totalLeads: leads.metrics[0]?.total || 0,
        convertedLeads: leads.metrics[0]?.converted || 0,
        totalReviews: reviews.metrics[0]?.total || 0,
        avgRating: reviews.metrics[0]?.avgRating
          ? Number(reviews.metrics[0].avgRating.toFixed(1))
          : 0,
        unansweredReviews: reviews.metrics[0]?.unanswered || 0,
        postsPublished: posts.metrics[0]?.published || 0,
        bufferDays,
      },
      charts: {
        leadsOverTime: leads.leadsOverTime.map((d: any) => ({ date: d._id, leads: d.count })),
        sourceDonut: leads.sourceDonut.map((d: any) => ({ name: d._id || 'Unknown', value: d.count })),
        starsDistribution: reviews.starsDistribution.map((d: any) => ({ star: d._id, count: d.count })),
      },
      panels: {
        recentLeads: leads.recentLeads,
        calendar: posts.calendar,
        followUps,
        activities,
      },
    };

    return NextResponse.json({ success: true, data: payload });
  } catch (error: any) {
    console.error('Dashboard Stats Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
