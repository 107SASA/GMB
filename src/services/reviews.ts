import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';
import Business from '@/models/Business';
import ReviewMonitorLog from '@/models/ReviewMonitorLog';
import { getReviewProvider } from './reviews/providers/index';
import { analyzeSentiment } from './reviews/sentimentEngine';
import { generateAIReply } from './ai';

/**
 * Review monitor: fetches new reviews from the active provider (SerpApi when
 * SERPAPI_KEY is set, mock otherwise), drafts an AI reply for each brand-new
 * review, and raises alerts. Unlike syncReviewsForBusiness (which only stores
 * reviews + analytics), this is the "auto-draft replies" pipeline behind
 * POST /api/reviews/monitor.
 */
export async function processNewReviews(businessId: string) {
  await dbConnect();

  try {
    const business = await Business.findById(businessId);
    if (!business) throw new Error('Business not found');

    const provider = getReviewProvider();
    const fetchedReviews = await provider.fetchReviews(businessId);

    let newReviewsDetected = 0;
    let aiRepliesGenerated = 0;
    let firstDraftedReviewId: string | null = null;
    let criticalDetails: { rating: number; reviewId: string } | null = null;
    const errors: string[] = [];

    for (const raw of fetchedReviews) {
      // Already stored by a previous monitor run or campaign sync
      const existing = await Review.findOne({ providerReviewId: raw.providerReviewId });
      if (existing) continue;

      newReviewsDetected++;
      try {
        const sentimentResult = analyzeSentiment(raw.text, raw.rating);
        const aiReply = await generateAIReply(raw.text, raw.rating, raw.reviewerName, 'Professional');

        const saved = await Review.create({
          tenantId: business.organizationId?.toString() || undefined,
          businessId: business._id,
          providerReviewId: raw.providerReviewId,
          reviewer: raw.reviewerName,
          rating: raw.rating,
          reviewText: raw.text,
          sentiment: sentimentResult.label,
          sentimentScore: sentimentResult.score,
          aiSuggestedReply: aiReply,
          replyStatus: 'PENDING',
          replyTone: 'Professional',
          sourcePlatform: 'Google',
          postedAt: new Date(raw.postedAt),
        });

        aiRepliesGenerated++;
        if (!firstDraftedReviewId) firstDraftedReviewId = saved._id.toString();
        if (sentimentResult.label === 'critical') {
          criticalDetails = { rating: raw.rating, reviewId: saved._id.toString() };
        }
      } catch (err: any) {
        errors.push(`Failed to process review from ${raw.reviewerName}: ${err.message}`);
      }
    }

    await ReviewMonitorLog.create({
      businessId: business._id,
      reviewsFetched: fetchedReviews.length,
      newReviewsDetected,
      aiRepliesGenerated,
      errorLogs: errors,
    });

    // Alerts go through the Inngest workers (push + WhatsApp + dashboard bell)
    if (criticalDetails) {
      try {
        const { inngest } = await import('@/services/inngest/client');
        await inngest.send({
          name: 'reviews/critical-alert',
          data: { businessId: business._id.toString(), ...criticalDetails },
        });
      } catch (e) {
        console.warn('[processNewReviews] Failed to send critical-alert event:', e);
      }
    }

    if (aiRepliesGenerated > 0) {
      try {
        const { inngest } = await import('@/services/inngest/client');
        await inngest.send({
          name: 'reviews/reply-drafted',
          data: {
            businessId: business._id.toString(),
            reviewId: firstDraftedReviewId,
            count: aiRepliesGenerated,
          },
        });
      } catch (e) {
        console.warn('[processNewReviews] Failed to send reply-drafted event:', e);
      }
    }

    return {
      success: true,
      stats: { fetched: fetchedReviews.length, new: newReviewsDetected, replies: aiRepliesGenerated },
      errors
    };
  } catch (error: any) {
    console.error('Process New Reviews Error:', error);
    return { success: false, error: error.message };
  }
}
