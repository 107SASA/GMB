import dbConnect from '@/lib/mongodb';
import Review, { type IReview } from '@/models/Review';
import ReviewReply from '@/models/ReviewReply';
import Business from '@/models/Business';
import { generateReviewReply } from '@/services/ai/replyEngine';
import { logAIUsage } from '@/lib/logAIUsage';
import { GROQ_MODEL } from '@/lib/aiModel';
import { postReviewReplyToGoogle } from './postReply';

/**
 * The "auto" half of Review Management's reply-mode toggle (see
 * Business.reviewReplySettings) — generates AND posts a reply with no human
 * approval step, unlike the manual generate → approve → post flow the
 * Review Management UI already had. Reuses the exact same generation
 * (replyEngine) and posting (postReply.ts) logic as that manual flow, so
 * "auto" behaves identically to a human clicking Generate → Approve → Post
 * back-to-back — just without waiting for the click.
 *
 * Best-effort per review: a failure here marks that one review FAILED with
 * a real reason and moves on, rather than aborting the whole batch.
 */
export async function autoReplyToReview(businessId: string, review: IReview): Promise<void> {
  // Already answered (either previously posted by us, or the profile
  // already had an owner reply mirrored in from Google at sync time) —
  // never overwrite an existing reply.
  if (review.replyStatus === 'POSTED' || review.response) return;

  await dbConnect();
  const business = await Business.findById(businessId).select('name userId reviewReplySettings').lean<{
    name?: string;
    userId?: { toString(): string };
    reviewReplySettings?: { tone?: string };
  }>();
  const tone = business?.reviewReplySettings?.tone || 'Professional';
  const businessName = business?.name || 'Local Business';
  const ownerId = business?.userId?.toString();

  try {
    const startMs = Date.now();
    const { reply, promptTokens, completionTokens } = await generateReviewReply({
      reviewText: review.reviewText,
      rating: review.rating,
      tone,
      businessName,
    });

    // Usage logging requires a real userId (AIUsageLog.userId is a required
    // ref) — attribute it to the workspace owner since there's no acting
    // user for an autonomous auto-reply. Skip rather than log against a
    // bogus id if the business somehow has no owner on record.
    if (ownerId) {
      void logAIUsage({
        userId: ownerId,
        businessId,
        promptType: 'review_reply_auto',
        aiModel: GROQ_MODEL,
        promptTokens,
        completionTokens,
        status: 'success',
        durationMs: Date.now() - startMs,
      });
    }

    review.aiSuggestedReply = reply;
    review.replyTone = tone;
    review.replyStatus = 'APPROVED'; // auto-mode skips the human approval step by design
    review.replyFailureReason = undefined;
    await review.save();

    await postReviewReplyToGoogle(businessId, review);

    review.response = review.aiSuggestedReply;
    review.replyStatus = 'POSTED';
    await review.save();

    await ReviewReply.create({
      reviewId: review._id,
      generatedReply: reply,
      approved: true,
      posted: true,
      tone,
      aiGenerated: true,
    });
  } catch (err: any) {
    review.replyStatus = 'FAILED';
    review.replyFailureReason = err?.message || 'Auto-reply failed.';
    await review.save();
    // Swallowed here deliberately — see processAutoReplyBatchJob in
    // services/inngest/functions.ts, which calls this per-review in a loop
    // and must not let one bad review stop the rest of the batch.
  }
}
