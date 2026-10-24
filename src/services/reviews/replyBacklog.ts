import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';

/**
 * Queue every unreplied, not-yet-drafted review of a business for the
 * auto-reply batch job (processAutoReplyBatchJob). Used when a business is
 * switched to auto-reply — by the owner (reviews/reply-settings) or by
 * scripts/migrate-review-reply-auto.ts — so "auto-reply to all reviews"
 * covers the existing backlog, not just reviews synced from now on.
 * Returns how many reviews were queued.
 */
export async function queueUnrepliedBacklog(businessId: string): Promise<number> {
  await dbConnect();
  const pending = await Review.find({
    businessId,
    response: { $in: [null, undefined, ''] },
    replyStatus: { $in: [null, 'PENDING'] },
  }).select('_id').lean();
  if (pending.length === 0) return 0;

  const { inngest } = await import('@/services/inngest/client');
  await inngest.send({
    name: 'reviews/auto-reply-batch',
    data: { businessId, reviewIds: pending.map((r) => r._id.toString()) },
  });
  return pending.length;
}
