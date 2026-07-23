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

  const bid = new mongoose.Types.ObjectId(businessId);

  // Reviews already stored for this business — passed to the provider so it can
  // stop paginating once it reaches known reviews ("fetch only new"), turning a
  // nightly re-sync from ~10 API calls into ~1. Empty on the first-ever sync, so
  // the provider back-fills normally.
  const existing = await Review.find({ businessId: bid })
    .select('providerReviewId')
    .lean() as Array<{ providerReviewId?: string }>;
  const knownReviewIds = new Set(
    existing.map((r) => r.providerReviewId).filter((id): id is string => !!id)
  );

  const provider = getReviewProvider();
  const fetchedReviews = await provider.fetchReviews(businessId, { knownReviewIds });

  let criticalFound = false;
  // Rating + id of the last critical review seen — carried on the alert
  // event so push notifications can say "New {rating}★ review".
  let criticalDetails: { rating: number; reviewId: string } | null = null;

  for (const raw of fetchedReviews) {
    const sentimentResult = analyzeSentiment(raw.text, raw.rating);
    if (sentimentResult.label === 'critical') criticalFound = true;

    const saved = await Review.findOneAndUpdate(
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
        // Google's real posted date. NOTE: setting createdAt here does NOT
        // work — Mongoose timestamps strip it from upserts — which is why
        // the dedicated postedAt field exists. Existing docs pick it up on
        // their next sync (upsert matches providerReviewId).
        postedAt: new Date(raw.postedAt),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (sentimentResult.label === 'critical' && saved) {
      criticalDetails = { rating: raw.rating, reviewId: saved._id.toString() };
    }
  }

  // Recompute analytics from the full review set using the SAME function every other
  // module reads (Review Management cards, Dashboard). This used to be a separate inline
  // calculation here, which could silently drift from what the rest of the app displayed.
  const metrics = await computeReviewMetrics(businessId);

  await ReviewAnalytics.findOneAndUpdate(
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
      await inngest.send({
        name: 'reviews/critical-alert',
        data: { businessId, ...(criticalDetails ?? {}) },
      });
    } catch (e) {
      console.warn('[syncReviews] Failed to send critical-alert event:', e);
    }
  }

  // postedAt = Google's real posted date; createdAt is only sync time.
  const allReviews = await Review.find({ businessId: bid }).sort({ postedAt: -1, createdAt: -1 });

  return {
    // Return the full metrics object (includes criticalReviews/starsDistribution, which
    // the persisted ReviewAnalytics document doesn't carry) so the UI has everything it
    // needs immediately after a sync, with numbers identical to a normal page load.
    analytics: metrics,
    reviews: allReviews,
    synced: fetchedReviews.length,
  };
}
