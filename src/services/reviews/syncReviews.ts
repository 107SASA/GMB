import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';
import ReviewAnalytics from '@/models/ReviewAnalytics';
import { getReviewProvider } from './providers/index';
import { analyzeSentiment } from './sentimentEngine';

export interface SyncResult {
  analytics: any;
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

  // Recompute analytics from the full review set (not just the page we just fetched)
  const allReviews = await Review.find({ businessId: bid });
  const total = allReviews.length;
  const avgRating = total > 0
    ? allReviews.reduce((sum, r) => sum + r.rating, 0) / total
    : 0;
  const unansweredCount = allReviews.filter(r => !r.response).length;
  const responseRate = total > 0 ? ((total - unansweredCount) / total) * 100 : 0;
  const positiveReviews = allReviews.filter(r => r.sentiment === 'positive').length;
  const negativeReviews = allReviews.filter(r => r.sentiment === 'negative' || r.sentiment === 'critical').length;
  const overallSentimentScore = total > 0
    ? allReviews.reduce((sum, r) => sum + (r.sentimentScore || 0), 0) / total
    : 0;

  const analytics = await ReviewAnalytics.findOneAndUpdate(
    { businessId: bid },
    {
      tenantId,
      avgRating: Number(avgRating.toFixed(1)),
      responseRate: Math.round(responseRate),
      sentimentScore: Math.round(overallSentimentScore),
      unansweredCount,
      totalReviews: total,
      positiveReviews,
      negativeReviews,
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

  return {
    analytics,
    reviews: allReviews.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    synced: fetchedReviews.length,
  };
}
