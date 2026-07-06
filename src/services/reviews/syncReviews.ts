import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';
import ReviewAnalytics from '@/models/ReviewAnalytics';
import { getReviewProvider } from './providers/index';
import { analyzeSentiment } from './sentimentEngine';
import { computeReviewMetrics, ReviewMetrics } from './reviewMetrics';

export interface SyncResult {
  analytics: ReviewMetrics;
  reviews: any[];
  synced: number;
}

/**
 * Core review sync logic — shared between the HTTP route and Inngest jobs.
 * Fetches from the active provider, upserts reviews, and refreshes analytics.
 */
export async function syncReviewsForBusiness(
  businessId: string,
  tenantId: string
): Promise<SyncResult> {
  await dbConnect();

  const provider = getReviewProvider();
  const fetchedReviews = await provider.fetchReviews(businessId);

  let criticalFound = false;
  const bid = new mongoose.Types.ObjectId(businessId);

  for (const raw of fetchedReviews) {
    const sentimentResult = analyzeSentiment(raw.text, raw.rating);
    if (sentimentResult.label === 'critical') criticalFound = true;

    await Review.findOneAndUpdate(
      { providerReviewId: raw.providerReviewId },
      {
        tenantId,
        businessId: bid,
        providerReviewId: raw.providerReviewId,
        reviewer: raw.reviewerName,
        rating: raw.rating,
        reviewText: raw.text,
        sentiment: sentimentResult.label,
        sentimentScore: sentimentResult.score,
        createdAt: new Date(raw.postedAt),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  // Recompute analytics from the full review set using the SAME function every other
  // module reads (Review Management cards, Dashboard). This used to be a separate inline
  // calculation here, which could silently drift from what the rest of the app displayed.
  const metrics = await computeReviewMetrics(businessId);

  const analytics = await ReviewAnalytics.findOneAndUpdate(
    { businessId: bid },
    {
      tenantId,
      avgRating: metrics.avgRating,
      responseRate: metrics.responseRate,
      sentimentScore: metrics.sentimentScore,
      unansweredCount: metrics.unansweredCount,
      totalReviews: metrics.totalReviews,
      positiveReviews: metrics.positiveReviews,
      negativeReviews: metrics.negativeReviews,
    },
    { upsert: true, new: true }
  );

  if (criticalFound) {
    try {
      // Dynamic import avoids circular dependency with inngest/functions.ts
      const { inngest } = await import('@/services/inngest/client');
      await inngest.send({ name: 'reviews/critical-alert', data: { businessId } });
    } catch (e) {
      console.warn('[syncReviews] Failed to send critical-alert event:', e);
    }
  }

  const allReviews = await Review.find({ businessId: bid }).sort({ createdAt: -1 });

  return {
    // Return the full metrics object (includes criticalReviews/starsDistribution, which
    // the persisted ReviewAnalytics document doesn't carry) so the UI has everything it
    // needs immediately after a sync, with numbers identical to a normal page load.
    analytics: metrics,
    reviews: allReviews,
    synced: fetchedReviews.length,
  };
}
