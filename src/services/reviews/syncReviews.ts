import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';
import ReviewAnalytics from '@/models/ReviewAnalytics';
import GBPToken from '@/models/GBPToken';
import { getReviewProvider } from './providers/index';
import { GbpApiReviewProvider } from './providers/GbpApiReviewProvider';
import { SerpApiGoogleProvider } from './providers/SerpApiGoogleProvider';
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
  tenantId: string,
  options?: { requireGbp?: boolean }
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

  // Prefer the OFFICIAL Google Business Profile API when this business is
  // connected: it returns real Google review IDs (so owner replies can be posted
  // back), the complete review set (nothing missing), and each review's existing
  // owner reply. Businesses without a GBP connection fall back to the configured
  // provider (SerpApi/mock).
  const gbpToken = await GBPToken.findOne({ businessId: bid }).select('_id').lean();
  if (options?.requireGbp && !gbpToken) {
    // Caller (the Review Management tab) demands the official API — don't fall
    // back to SerpApi, which can't support posting replies.
    throw new Error('Google Business Profile is not connected — connect it to sync reviews.');
  }
  const provider = gbpToken ? new GbpApiReviewProvider() : getReviewProvider();
  const fetchedReviews = await provider.fetchReviews(businessId, { knownReviewIds });

  // Tags every review upserted below with where it actually came from — the
  // reply-posting flow (post-reply/route.ts) refuses to post anything that
  // isn't 'gbp_api', since only real Google review ids can receive a reply.
  const source: 'gbp_api' | 'serpapi' | 'mock' = gbpToken
    ? 'gbp_api'
    : provider instanceof SerpApiGoogleProvider
      ? 'serpapi'
      : 'mock';

  // Rating + id of the last critical review seen — carried on the alert
  // event so push notifications can say "New {rating}★ review".
  let criticalDetails: { rating: number; reviewId: string } | null = null;

  // Sentiment is a fast local computation (no I/O — see sentimentEngine.ts),
  // so it's done synchronously up front to keep "last critical review in
  // array order wins" deterministic even though the DB upserts below run
  // concurrently instead of one at a time.
  const sentiments = fetchedReviews.map((raw) => analyzeSentiment(raw.text, raw.rating));
  const criticalFound = sentiments.some((s) => s.label === 'critical');

  const upsertResults = await Promise.all(
    fetchedReviews.map(async (raw, i) => {
      const sentimentResult = sentiments[i];
      const update: Record<string, unknown> = {
        tenantId,
        businessId: bid,
        providerReviewId: raw.providerReviewId,
        reviewer: raw.reviewerName,
        rating: raw.rating,
        reviewText: raw.text,
        sentiment: sentimentResult.label,
        sentimentScore: sentimentResult.score,
        source,
        // Google's real posted date. NOTE: setting createdAt here does NOT
        // work — Mongoose timestamps strip it from upserts — which is why
        // the dedicated postedAt field exists. Existing docs pick it up on
        // their next sync (upsert matches providerReviewId).
        postedAt: new Date(raw.postedAt),
      };
      // If the profile already carries an owner reply (from the GBP API), mirror
      // it so the UI shows the review as answered and we never re-reply to it.
      if (raw.ownerReply) {
        update.response = raw.ownerReply;
        update.replyStatus = 'POSTED';
      }

      const saved = await Review.findOneAndUpdate(
        { providerReviewId: raw.providerReviewId },
        update,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      return { raw, sentimentResult, saved };
    }),
  );

  // Same "last critical review in fetchedReviews order wins" semantics as
  // the previous sequential loop — resolved from the array, not from
  // whichever upsert happened to finish last.
  for (const { raw, sentimentResult, saved } of upsertResults) {
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
