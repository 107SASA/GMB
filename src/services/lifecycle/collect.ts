import dbConnect from '@/lib/mongodb';
import { summarizeContent, type ExecutionRecords } from './monthly';


/**
 * Execution records for a business in [from, to) — database reads only, never
 * a provider call. A GrowwMatics action counts only when the record shows the
 * write actually reached Google (liveWriteApplied / publishedVia).
 */
export async function collectExecutions(businessId: string, from: Date, to: Date): Promise<ExecutionRecords> {
  await dbConnect();
  const [{ default: Post }, { default: Review }, { default: ProfileActivity }, { default: GbpMediaAsset }, { default: ReviewRequest }] = await Promise.all([
    import('@/models/Post'),
    import('@/models/Review'),
    import('@/models/ProfileActivity'),
    import('@/models/GbpMediaAsset'),
    import('@/models/ReviewRequest'),
  ]);
  const inRange = { $gte: from, $lt: to };
  const [posts, replies, edits, photos, reqSentRows, reqFailed, newReviews, contentRows] = await Promise.all([
    Post.find({ businessId, status: 'published', publishedAt: inRange, liveWriteApplied: true }).select('publishedAt aiGenerated automationMetadata title').lean(),
    Review.find({ businessId, replyStatus: 'POSTED', replyPostedAt: inRange }).select('replyPostedAt replyPostedBy replyLiveWriteApplied').lean(),
    ProfileActivity.find({ businessId, type: 'profile_updated', createdAt: inRange }).select('createdAt metadata updatedBy').lean(),
    GbpMediaAsset.find({ businessId, status: 'published', publishedVia: 'growwmatics', publishedAt: inRange }).select('publishedAt').lean(),
    ReviewRequest.find({ businessId, status: { $in: ['Sent', 'Delivered'] }, sentAt: inRange }).select('sentAt').lean(),
    ReviewRequest.countDocuments({ businessId, status: 'Failed', createdAt: inRange }),
    Review.find({ businessId, postedAt: inRange }).select('postedAt rating response replyCheckedAt replyStatus').lean(),
    Post.find({ businessId, contentMeta: { $exists: true }, scheduledDate: inRange }).select('status liveWriteApplied contentMeta').lean(),
  ]);
  return {
    posts: (posts as any[]).map((p) => ({ at: new Date(p.publishedAt).toISOString(), autopilot: !!p.aiGenerated && !!p.automationMetadata?.generatedVia, title: p.title })),
    replies: (replies as any[])
      // Our replies count only when they reached Google; external ones are Google's own record.
      .filter((r) => r.replyPostedBy === 'external' || r.replyLiveWriteApplied === true)
      .map((r) => ({ at: r.replyPostedAt ? new Date(r.replyPostedAt).toISOString() : null, by: r.replyPostedBy || 'external' })),
    profileEdits: (edits as any[]).map((e) => ({
      at: new Date(e.createdAt).toISOString(),
      fields: Array.isArray(e.metadata?.fields) ? e.metadata.fields : [],
      values: e.metadata?.values,
      liveWriteApplied: typeof e.metadata?.liveWriteApplied === 'boolean' ? e.metadata.liveWriteApplied : null,
      actor: e.metadata?.actor === 'growwmatics' ? 'growwmatics' : 'owner',
      by: e.updatedBy,
    })),
    photos: (photos as any[]).map((p) => ({ at: new Date(p.publishedAt).toISOString() })),
    reviewRequests: { sent: (reqSentRows as any[]).length, failed: reqFailed, sentAt: (reqSentRows as any[]).map((r) => new Date(r.sentAt).toISOString()) },
    newReviews: (newReviews as any[]).map((r) => ({
      at: new Date(r.postedAt).toISOString(),
      rating: r.rating,
      replied: r.response || r.replyStatus === 'POSTED' ? true : r.replyCheckedAt ? false : null,
    })),
    content: summarizeContent(contentRows as any[]),
  };
}
