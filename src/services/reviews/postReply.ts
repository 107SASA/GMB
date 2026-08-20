import { gbpWritesEnabled } from '@/lib/gbpSafety';
import type { IReview } from '@/models/Review';

/**
 * Pushes a review's `aiSuggestedReply` to the real Google Business Profile.
 * Shared by both reply paths — the manual "Post Reply" button
 * (app/api/reviews/[id]/post-reply/route.ts) and the auto-reply pipeline
 * (autoReply.ts) — so the safety gate and the "only real Google review ids
 * are reply-eligible" check can't drift between the two.
 *
 * SAFETY: gated behind GBP_LIVE_WRITES_ENABLED (off by default, see
 * src/lib/gbpSafety.ts). While disabled this only reports what WOULD have
 * happened — nothing is pushed to the customer's live profile.
 */
export async function postReviewReplyToGoogle(
  businessId: string,
  review: Pick<IReview, 'source' | 'providerReviewId' | 'aiSuggestedReply' | '_id'>
): Promise<{ liveWriteApplied: boolean }> {
  if (!gbpWritesEnabled()) {
    console.log(`[MOCK] GBP live writes disabled — recording reply locally only for review ${review._id}: "${review.aiSuggestedReply}"`);
    return { liveWriteApplied: false };
  }

  // NOTE: providerReviewId is always present (SerpApi/mock reviews have one
  // too, just a synthetic one — see providers/SerpApiGoogleProvider.ts), so
  // checking for its mere presence isn't enough. Only source === 'gbp_api'
  // means this review actually came from the official API and can receive
  // a reply — see services/reviews/syncReviews.ts.
  if (review.source !== 'gbp_api' || !review.providerReviewId) {
    throw new Error('Cannot post reply: this review is not from a connected Google Business Profile (connect Google to reply to it).');
  }

  const { replyToReview } = await import('@/lib/gbpClient');
  await replyToReview(businessId, review.providerReviewId, review.aiSuggestedReply!);
  return { liveWriteApplied: true };
}
