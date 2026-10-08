import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';
import ReviewAnalytics from '@/models/ReviewAnalytics';
import GBPToken from '@/models/GBPToken';
import Business from '@/models/Business';
import { getReviewProvider } from './providers/index';
import { GbpApiReviewProvider } from './providers/GbpApiReviewProvider';
import { chooseReviewSyncMode, reportedReviewConflicts } from './providers/gbpReviewPaging';
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
  const gbpToken = await GBPToken.findOne({ businessId: bid }).select('_id reviewSync').lean<{ _id: unknown; reviewSync?: any }>();
  if (options?.requireGbp && !gbpToken) {
    // Caller (the Review Management tab) demands the official API — don't fall
    // back to SerpApi, which can't support posting replies.
    throw new Error('Google Business Profile is not connected — connect it to sync reviews.');
  }
  const provider = gbpToken ? new GbpApiReviewProvider() : getReviewProvider();

  // GBP API: full import first, a full backfill (at most daily) while fewer
  // reviews are stored than Google reports, otherwise incremental from the
  // updateTime watermark (which also re-reads replies/edits made on Google to
  // older reviews). SerpApi / mock keep the original known-id behaviour.
  let syncMode: 'full' | 'incremental' | 'known_ids' | null = null;
  if (gbpToken) {
    const biz = await Business.findById(bid).select('googleReviewTotals').lean<{ googleReviewTotals?: { count?: number; source?: string } }>();
    const rs = gbpToken.reviewSync || null;
    syncMode = chooseReviewSyncMode({
      storedCount: knownReviewIds.size,
      googleTotal: biz?.googleReviewTotals?.source === 'gbp_api' ? biz.googleReviewTotals.count : rs?.googleTotal ?? null,
      watermark: rs?.maxUpdateTime ?? null,
      lastFullSyncAt: rs?.lastFullSyncAt ?? null,
      now: new Date(),
    });
  }
  const fetchedReviews = await provider.fetchReviews(
    businessId,
    gbpToken
      ? { knownReviewIds, mode: syncMode!, sinceUpdateTime: gbpToken.reviewSync?.maxUpdateTime ?? null }
      : { knownReviewIds },
  );

  // Google's lifetime total + rating as reported by the provider itself —
  // the audit's "Total reviews" source (see auditService.ts). The mock
  // provider has none, so nothing is written for it.
  const totals = (provider as { lastTotals?: { count: number; rating: number | null } | null }).lastTotals;
  if (totals && (provider instanceof GbpApiReviewProvider || provider instanceof SerpApiGoogleProvider)) {
    await Business.updateOne(
      { _id: bid },
      {
        $set: {
          googleReviewTotals: {
            count: totals.count,
            rating: totals.rating,
            source: provider instanceof GbpApiReviewProvider ? 'gbp_api' : 'serpapi',
            capturedAt: new Date(),
          },
        },
      },
    ).catch((e: any) => console.warn('[syncReviews] could not store review totals:', e?.message));
  }

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
  // Alerts and reply drafting only for reviews new to GrowwMatics. A full
  // import/backfill also re-reads old reviews: those must not trigger
  // "critical review" alerts or AI replies to years-old reviews.
  const recentCutoffMs = Date.now() - 30 * 86_400_000;
  const isAlertable = (raw: (typeof fetchedReviews)[number]) =>
    !knownReviewIds.has(raw.providerReviewId) &&
    (syncMode !== 'full' || new Date(raw.postedAt).getTime() >= recentCutoffMs);
  const criticalFound = sentiments.some((s, i) => s.label === 'critical' && isAlertable(fetchedReviews[i]));

  let conflicts = 0;
  const upsertResults = await Promise.all(
    fetchedReviews.map(async (raw, i) => {
      const sentimentResult = sentiments[i];
      const update: Record<string, unknown> = {
        tenantId,
        businessId: bid,
        providerReviewId: raw.providerReviewId,
        reviewer: raw.reviewerName,
        reviewerPhotoUrl: raw.reviewerPhotoUrl,
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
        // Every provider (GBP API, SerpApi, mock) reads the owner reply, so a
        // missing reply after this sync genuinely means "no reply".
        replyCheckedAt: new Date(),
      };
      // If the profile already carries an owner reply (from the GBP API), mirror
      // it so the UI shows the review as answered and we never re-reply to it.
      if (raw.ownerReply) {
        update.response = raw.ownerReply;
        update.replyStatus = 'POSTED';
      }

      // Scoped to THIS business: a review id is only ever matched inside the
      // workspace that synced it, so it can never move to another workspace.
      // While the legacy global unique index on providerReviewId exists, a
      // second workspace linked to the same Google location gets E11000 here —
      // that review is skipped and counted, never reassigned.
      let saved: any = null;
      try {
        saved = await Review.findOneAndUpdate(
          { businessId: bid, providerReviewId: raw.providerReviewId },
          update,
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } catch (err: any) {
        if (err?.code !== 11000) throw err;
        conflicts++;
        return { raw, sentimentResult, saved: null };
      }
      // A reply we did not post (no GrowwMatics execution record) is the
      // owner's or someone else's, made directly on Google.
      if (raw.ownerReply && saved && !(saved as any).replyPostedBy) {
        await Review.updateOne({ _id: saved._id, replyPostedBy: { $exists: false } }, { $set: { replyPostedBy: 'external' } });
      }

      return { raw, sentimentResult, saved };
    }),
  );

  // Same "last critical review in fetchedReviews order wins" semantics as
  // the previous sequential loop — resolved from the array, not from
  // whichever upsert happened to finish last.
  for (const { raw, sentimentResult, saved } of upsertResults) {
    if (sentimentResult.label === 'critical' && saved && isAlertable(raw)) {
      criticalDetails = { rating: raw.rating, reviewId: saved._id.toString() };
    }
  }

  if (conflicts > 0) {
    console.warn(`[syncReviews] ${conflicts} review(s) for business ${businessId} are already stored under another workspace (same Google review id) — skipped, not moved.`);
  }

  // Completeness bookkeeping for the GBP API path (FR-3.2): watermark for the
  // next incremental run, when the last full pass happened, and whether the
  // import cap stopped it before Google's total.
  if (gbpToken && provider instanceof GbpApiReviewProvider && provider.lastRun) {
    const run = provider.lastRun;
    const prevRs = gbpToken.reviewSync || {};
    const maxUpdateTime = [prevRs.maxUpdateTime, run.maxUpdateTime].filter(Boolean).sort().pop() ?? null;
    const storedAfter = knownReviewIds.size + upsertResults.filter(
      ({ raw, saved }) => saved && !knownReviewIds.has(raw.providerReviewId),
    ).length;
    const googleTotalNow = provider.lastTotals?.count ?? prevRs.googleTotal ?? null;
    const conflictsToStore = reportedReviewConflicts({
      upsertConflicts: conflicts,
      previousConflicts: Number(prevRs.conflicts || 0),
      storedCount: storedAfter,
      googleTotal: googleTotalNow,
    });
    if (conflicts === 0 && conflictsToStore > 0) {
      console.warn(`[syncReviews] ${conflictsToStore} review(s) for business ${businessId} are still missing after a pass that imported nothing — keeping the identity conflict count.`);
    }
    await GBPToken.updateOne(
      { businessId: bid },
      {
        $set: {
          reviewSync: {
            lastRunAt: new Date(),
            mode: run.mode === 'full' ? 'full' : 'incremental',
            fetched: run.fetched,
            maxUpdateTime,
            lastFullSyncAt: run.mode === 'full' ? new Date() : prevRs.lastFullSyncAt ?? null,
            hitCap: run.mode === 'full' ? run.hitCap : !!prevRs.hitCap,
            googleTotal: googleTotalNow,
            conflicts: conflictsToStore,
          },
        },
      },
    ).catch((e: any) => console.warn('[syncReviews] could not store review sync state:', e?.message));
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

  // Reply drafting (Sep 2026): every newly synced review without a reply gets
  // a fact-checked DRAFT for the owner to approve (recent reviews only, so a
  // first sync of a long history doesn't burn AI calls on years-old reviews).
  // It is published automatically ONLY when the owner switched auto-reply on
  // (mode 'auto' + consent) and the draft passed the check — see
  // services/reviews/autoReply.ts + replyPipeline.ts.
  const business = await Business.findById(bid).select('reviewReplySettings').lean<{
    reviewReplySettings?: { mode?: string; autoPublishConsentAt?: Date };
  }>();
  {
    const { isAutoPublishActive } = await import('./replyPipeline');
    const auto = isAutoPublishActive(business?.reviewReplySettings);
    const recentCutoff = Date.now() - 30 * 86_400_000;
    const pendingIds = upsertResults
      .filter(({ raw }) => isAlertable(raw))
      .filter(({ saved }) => saved && !saved.response && (!saved.replyStatus || saved.replyStatus === 'PENDING'))
      .filter(({ saved }) => auto || new Date((saved as any).postedAt ?? (saved as any).createdAt).getTime() >= recentCutoff)
      .map(({ saved }) => saved!._id.toString());
    if (pendingIds.length > 0) {
      try {
        const { inngest } = await import('@/services/inngest/client');
        await inngest.send({
          name: 'reviews/auto-reply-batch',
          data: { businessId, reviewIds: pendingIds },
        });
      } catch (e) {
        console.warn('[syncReviews] Failed to send auto-reply-batch event:', e);
      }
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
