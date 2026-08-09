import dbConnect from '../../lib/mongodb';
import Audit from '../../models/Audit';
import Business from '../../models/Business';
import Review from '../../models/Review';
import { generateAIAudit } from '../ai/auditEngine';
import { logAIUsage } from '../../lib/logAIUsage';

export async function processAuditJob(auditId: string) {
  await dbConnect();

  const audit = await Audit.findById(auditId);
  if (!audit) throw new Error(`Audit not found: ${auditId}`);
  if (audit.status !== 'PENDING') {
    console.log(`Audit ${auditId} is already ${audit.status}`);
    return;
  }

  try {
    const business = await Business.findById(audit.businessId);
    if (!business) throw new Error(`Business not found for audit ${auditId}`);

    // Feature 2A — Review Analysis Range Selector: only reviews posted
    // within the selected window are fetched/analyzed. Falls back to the
    // schema default (14 days) for older jobs / callers that didn't pass one.
    const reviewPeriodDays = audit.reviewPeriodDays || 14;
    const reviewPeriodSince = new Date(Date.now() - reviewPeriodDays * 24 * 60 * 60 * 1000);
    // A review's real-world date is `postedAt` (from Google); `createdAt` is
    // only when we synced it, so it's used as a fallback for reviews synced
    // before `postedAt` was backfilled.
    const reviewDateFilter = {
      $or: [
        { postedAt: { $gte: reviewPeriodSince } },
        { postedAt: { $exists: false }, createdAt: { $gte: reviewPeriodSince } },
      ],
    };

    // Fetch real reviews — cap at MAX_REVIEWS_PER_AUDIT (default 50)
    const maxReviews = parseInt(process.env.MAX_REVIEWS_PER_AUDIT || '50', 10);
    const fetchStoredReviews = () =>
      Review.find({ businessId: business._id, ...reviewDateFilter })
        .sort({ postedAt: -1, createdAt: -1 })
        .limit(maxReviews);

    let reviewsData = await fetchStoredReviews();

    // ── Business data payload for analyzers ───────────────────
    // Extract city from address if the city field was not explicitly set.
    // Indian address format: "..., Area, City, State PostalCode, Country"
    // → city is typically the 3rd segment from the end.
    // audit.userDefinedCategory / audit.city are set from the form overrides at job creation time
    // Resolved up front (before reviews) — neither depends on review data,
    // and both are needed to kick off geo-grid rankings without waiting.
    const resolvedCity = audit.city || business.city || (() => {
      if (!business.address) return '';
      const parts = business.address.split(',').map((p: string) => p.trim()).filter(Boolean);
      return parts.length >= 3 ? (parts[parts.length - 3] || '') : (parts[parts.length - 1] || '');
    })();
    const resolvedCategory = audit.userDefinedCategory || business.userDefinedCategory || business.category || 'Local Business';

    // ── Native analytics ──────────────────────────────────────
    const {
      calculateProfileCompletion,
      calculateReviewMetrics,
      calculateReviewQualityScore,
      analyzeReviewKeywords,
      fetchGeoGridRankings,
      calculateNativeSeoScore,
      calculateAuditConfidence,
      generateNativePriorityFixes,
      calculateBusinessIntelligence,
    } = require('./seoAnalyzer');

    // Review sync (only runs on a business's first-ever audit, when nothing
    // is cached yet), geo-grid rankings (45 DataForSEO calls sent as a single
    // batched request — see dataForSeoClient.ts), and competitor discovery
    // (Google Places) are all independent of each other — sync doesn't touch
    // rank data, geo-grid only needs category/city, and competitor search
    // only needs category/city/name/website. Running all three concurrently
    // instead of sequentially is what keeps a brand-new business's first
    // report from taking a minute-plus: previously a first-time sync
    // (data-ID resolve + paginated review fetch, ~15-25s) finished completely
    // before geo-grid (~15-40s) even started, and competitor search ran only
    // after both of those.
    // fastMode (lead-gen entry points only, see src/lib/startAudit.ts) skips
    // both the first-time review sync and geo-grid ranking below — the two
    // biggest, slowest steps — trading rank/review precision for a report
    // that generates in seconds instead of up to a minute. Paying customers'
    // audits (POST /api/audit, fastMode always false) are unaffected; both
    // steps already have honest "unavailable" fallbacks for when DataForSEO
    // credentials are missing, reused here rather than adding new branches.
    const needsReviewSync = reviewsData.length === 0 && !!process.env.SERPAPI_KEY && !audit.fastMode;
    const reviewSyncTask: Promise<typeof reviewsData> = needsReviewSync
      ? (async () => {
          console.log(`[auditService] No reviews in DB for businessId=${audit.businessId} in the last ${reviewPeriodDays}d — attempting live fetch`);
          try {
            const { syncReviewsForBusiness } = require('../reviews/syncReviews');
            const tenantId = business.organizationId?.toString() || audit.tenantId;
            await syncReviewsForBusiness(business._id.toString(), tenantId);
            const synced = await fetchStoredReviews();
            console.log(`[auditService] Auto-synced ${synced.length} reviews for ${business.name} within the last ${reviewPeriodDays}d`);
            return synced;
          } catch (syncErr: any) {
            console.warn(`[auditService] Review auto-sync failed: ${syncErr.message}`);
            return reviewsData;
          }
        })()
      : Promise.resolve(reviewsData);

    // Augment business with the resolved category + city so geo-grid keywords
    // are correct even when the stored business profile has no category set.
    const businessObj = typeof business.toObject === 'function' ? business.toObject() : business;
    const businessForRankings = {
      ...businessObj,
      name: businessObj.name || business.name,
      category: resolvedCategory,
      city:     resolvedCity,
      placeId: businessObj.placeId || businessObj.googlePlaceId,
      googlePlaceId: businessObj.googlePlaceId || businessObj.placeId,
      serpApiDataId: businessObj.serpApiDataId || businessObj.dataId,
    };
    const { dataForSeoConfigured } = require('./dataForSeoClient');
    const geoGridTask = dataForSeoConfigured && !audit.fastMode
      ? fetchGeoGridRankings(businessForRankings)
      : Promise.resolve(null);

    // Competitor discovery (Google Places) only needs category/city/name/
    // website — none of which depend on the review sync above — so it runs
    // alongside it instead of waiting for it to finish first. reviewCount is
    // read from the reviews already in the DB (reviewsData, fetched before
    // this block); that's the real count except on a business's very first
    // audit, when it's 0 either way since nothing has synced yet.
    const { findCompetitors } = require('./competitorService');
    const competitorsTask = findCompetitors({
      businessName: business.name,
      category:     resolvedCategory,
      city:         resolvedCity,
      area:         business.area    || '',
      state:        business.state   || '',
      country:      business.country || '',
      website:      business.website || '',
      reviewCount:  reviewsData.length,
    });

    const [syncedReviewsData, rankData, competitorsResult] = await Promise.all([
      reviewSyncTask,
      geoGridTask,
      competitorsTask,
    ]);
    reviewsData = syncedReviewsData;
    const { accepted, rejected, targetTier, evidenceSource: compEvidence } = competitorsResult;

    // Geo-grid keyword rankings via DataForSEO (45 calls: 5 keywords × 9 grid points)
    let keywordRankings: any[] = [];
    let rankingsEvidence = audit.fastMode
      ? 'Skipped for fast report generation'
      : 'Unavailable (DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD not configured)';
    let geoGridRank: any = null;
    let localPackCompetitors: any[] = [];

    if (rankData) {
      keywordRankings      = rankData.legacyRankings;
      rankingsEvidence     = rankData.evidenceSource;
      geoGridRank          = rankData.geoGridRank;
      localPackCompetitors = rankData.localPackCompetitors || [];
    } else if (audit.fastMode) {
      keywordRankings = [];
      console.log(`[auditService] fastMode audit ${audit._id} — skipping geo-grid ranking & review sync`);
    } else {
      // Do NOT invent fake rank-21 keywords — surface unavailable honestly.
      keywordRankings = [];
      console.warn('[auditService] DataForSEO credentials missing — skipping live ranking & competitor harvest');
    }

    // Include sentiment so scoring functions can use real sentiment data
    const formattedReviews = reviewsData.map(r => ({
      author:        r.reviewer     || 'Anonymous',
      rating:        r.rating       || 0,
      text:          r.reviewText   || '',
      // postedAt = Google's real review date; createdAt is only the sync
      // time and skews reviews-per-week after bulk syncs.
      date:          (r.postedAt ?? r.createdAt)?.toISOString() || new Date().toISOString(),
      ownerReply:    r.replyText,
      sentiment:     r.sentiment    || 'neutral',
      sentimentScore: r.sentimentScore || 0,
    }));

    const businessData = {
      businessName:   business.name,
      category:       resolvedCategory,
      city:           resolvedCity,
      area:           business.area    || '',
      state:          business.state   || '',
      country:        business.country || '',
      website:        business.website || '',
      phone:          business.phone   || '',
      description:    business.description || '',
      googleMapsUrl:  business.googleMapsUrl || '',
      rating:         0,
      reviewCount:    formattedReviews.length,
      reviews:        formattedReviews,
    };

    // Places snapshot fallback (see Business.placesRating/placesReviewCount):
    // a rating+count read live from the Places API when the visitor picked
    // their listing on /free-report, stored at intake. Only used here to
    // keep the AI-written narrative and the displayed reviewCount/rating
    // from contradicting each other when no reviews have been synced yet —
    // it does NOT feed formattedReviews, so scoring (reviewQualityScore,
    // keywordCoverageScore, hasReviewData below) is untouched by this.
    const placesReviewCount = typeof business.placesReviewCount === 'number' ? business.placesReviewCount : undefined;
    const placesRating      = typeof business.placesRating === 'number' ? business.placesRating : undefined;
    const hasPlacesSnapshot = !!placesReviewCount && placesReviewCount > 0 && placesRating != null;

    if (formattedReviews.length > 0) {
      const sum = formattedReviews.reduce((acc, r) => acc + r.rating, 0);
      businessData.rating = parseFloat((sum / formattedReviews.length).toFixed(1));
    } else if (hasPlacesSnapshot) {
      businessData.rating = placesRating!;
      businessData.reviewCount = placesReviewCount!;
    }

    const profileCompletionPayload = calculateProfileCompletion(business);
    const reviewMetricsPayload     = calculateReviewMetrics(formattedReviews);

    const profileCompletion = profileCompletionPayload.data;
    const reviewMetrics     = reviewMetricsPayload.data;

    const avgRank = keywordRankings.length > 0
      ? keywordRankings.reduce((acc: number, k: any) => acc + k.rank, 0) / keywordRankings.length
      : 0;
    const googleSearchRank = {
      averageRank: parseFloat(avgRank.toFixed(1)),
      topKeywords: keywordRankings,
    };

    // Attach real local-pack ranks onto Places competitors when names match.
    const enrichWithLocalPackRank = (list: any[]) =>
      list.map((c: any) => {
        const match = localPackCompetitors.find(
          (lp: any) => (lp.name || '').toLowerCase().trim() === (c.name || '').toLowerCase().trim(),
        );
        const avgRank = match?.avgRank ?? c.avgRank ?? c.estimatedRank;
        return {
          ...c,
          avgRank,
          estimatedRank: avgRank,
        };
      });

    // Prefer Places-tier matches when available, else SerpApi local-pack harvest.
    // Always carry avgRank/estimatedRank so the report table can render.
    const effectiveCompetitors = accepted.length > 0
      ? enrichWithLocalPackRank(accepted)
      : localPackCompetitors.map((c: any) => ({
          name: c.name,
          rating: c.rating || 0,
          reviewCount: c.reviewCount || 0,
          category: businessData.category,
          similarityScore: 60,
          tier: targetTier,
          avgRank: c.avgRank,
          estimatedRank: c.avgRank,
          placeId: c.placeId,
        }));

    // ── Review quality + keyword coverage ─────────────────────
    const reviewQualityScore  = calculateReviewQualityScore(formattedReviews) as number;
    const reviewKeywordResult = analyzeReviewKeywords(formattedReviews, business);
    const keywordCoverageScore = (reviewKeywordResult.keywordScore || 0) as number;

    // ── SEO + confidence + priority fixes ─────────────────────
    const nativeSeoScore      = calculateNativeSeoScore(business, profileCompletion);
    const auditConfidence     = calculateAuditConfidence(
      profileCompletion.completionPercentage,
      effectiveCompetitors.length,
      formattedReviews.length,
      !!business.website,
    );
    const nativePriorityFixes = generateNativePriorityFixes(
      business, profileCompletion, formattedReviews.length, effectiveCompetitors,
    );
    const businessIntelligence = calculateBusinessIntelligence(
      business, effectiveCompetitors, formattedReviews.length,
    );

    // ── Scoring formula ────────────────────────────────────────
    // Weights: profile 35 | SEO 25 | review quality 25 | keyword coverage 15
    // All inputs are 0-100; result is clamped to 0-100.
    //
    // Both review-quality and keyword-coverage are entirely derived from
    // synced reviews, and calculateReviewQualityScore/analyzeReviewKeywords
    // both return 0 for an empty review list — so a business with no synced
    // reviews yet (e.g. Google was just connected, before any sync has run)
    // was unfairly dragged down by a hardcoded 0 across 40% of the score, for
    // reasons that have nothing to do with the business itself. When there's
    // no real review data, drop those two inputs and re-weight the remaining,
    // genuinely-available signals (profile completion + SEO) to 100%.
    const hasReviewData = formattedReviews.length > 0;
    const finalScore = Math.round(Math.min(100,
      hasReviewData
        ? profileCompletion.completionPercentage * 0.35 +
          nativeSeoScore.score                  * 0.25 +
          reviewQualityScore                    * 0.25 +
          keywordCoverageScore                  * 0.15
        : profileCompletion.completionPercentage * 0.60 +
          nativeSeoScore.score                  * 0.40,
    ));

    // ── Persist debug + sync metadata ────────────────────────
    // Feature 2B — resolved here (before the metadata write below) so both
    // the metadata and the AI call further down share the same value.
    const actionPlanDurationDays = audit.actionPlanDurationDays || 30;

    audit.metadata = audit.metadata || {};
    audit.metadata.reviewsSyncedAt    = new Date().toISOString();
    audit.metadata.reviewsActualCount = formattedReviews.length;
    audit.metadata.reviewPeriodDays   = reviewPeriodDays;
    audit.metadata.actionPlanDurationDays = actionPlanDurationDays;
    audit.metadata.debug = {
      businessName:       businessData.businessName,
      category:           businessData.category,
      area:               businessData.area,
      city:               businessData.city,
      reviewCount:        businessData.reviewCount,
      reviewPeriodDays,
      reviewQualityScore,
      keywordCoverageScore,
      tier:               targetTier,
      competitorsFound:   accepted,
      competitorsRejected: rejected,
      reviewKeywords:     reviewKeywordResult,
    };
    await audit.save();

    const enrichedBusinessData = {
      ...businessData,
      tier:       targetTier,
      competitors: effectiveCompetitors,
      nativeAnalytics: {
        profileCompletion,
        reviewMetrics,
        googleSearchRank,
        seoScore:           nativeSeoScore,
        auditConfidence,
        priorityFixes:      nativePriorityFixes,
        businessIntelligence,
        reviewKeywords:     reviewKeywordResult,
      },
    };

    // ── AI analysis ───────────────────────────────────────────
    // Feature 2B — Improvement Plan Duration: the selected duration (30/45/90
    // days) shapes the generated action plan's cadence and focus, not just
    // its heading. See generateAIAudit's per-duration prompt instructions.
    const auditStartMs = Date.now();
    const aiResult = await generateAIAudit(enrichedBusinessData, { actionPlanDurationDays });
    if (aiResult === 'Data Unavailable') throw new Error('Data Unavailable');

    void logAIUsage({
      userId:      audit.userId,
      businessId:  audit.businessId?.toString(),
      promptType:  'audit_generation',
      aiModel:     'llama-3.3-70b-versatile',
      promptTokens:     aiResult._usage?.promptTokens    ?? 0,
      completionTokens: aiResult._usage?.completionTokens ?? 0,
      status:      'success',
      durationMs:  Date.now() - auditStartMs,
    });

    // ── Merge native truths over AI output ───────────────────
    if (typeof aiResult === 'object') {
      aiResult.googleSearchRank    = googleSearchRank;
      aiResult.profileCompletion   = profileCompletion;
      aiResult.seoScore            = nativeSeoScore;
      aiResult.auditConfidence     = auditConfidence;
      aiResult.businessIntelligence = businessIntelligence;

      // No real reviews synced yet (e.g. Google was just connected) — omit
      // the section entirely rather than merging in a hollow "0 reviews,
      // 0 rating" block that would misleadingly read as a real finding.
      // AuditReportGrexa checks for this and skips rendering the section.
      if (hasReviewData) {
        aiResult.reviewAnalysis = {
          ...aiResult.reviewAnalysis,
          reviewCount:    reviewMetrics.reviewCount,
          averageRating:  reviewMetrics.averageRating,
          reviewsPerWeek: reviewMetrics.reviewsPerWeek,
          industryAverage: reviewMetrics.industryAverage,
          responseRate:   reviewMetrics.responseRate,
          positivePercent: reviewMetrics.positivePercent,
          neutralPercent:  reviewMetrics.neutralPercent,
          negativePercent: reviewMetrics.negativePercent,
        };
      } else if (hasPlacesSnapshot) {
        // No synced Review documents (fastMode audits skip that sync — see
        // needsReviewSync above), but we have a real rating/count read live
        // from Places at intake. Show that instead of omitting the section —
        // per-review detail (reviews/week, response rate, sentiment split)
        // genuinely isn't available without synced reviews, so those are left
        // at 0/'0%' and flagged via `estimatedFromPlaces` rather than implied
        // as real findings; AuditReportGrexa hides just those sub-widgets
        // when it sees the flag. Scoring is untouched: hasReviewData (used
        // for reviewQualityScore/keywordCoverageScore/finalScore above) is
        // still driven only by formattedReviews, not this fallback.
        aiResult.reviewAnalysis = {
          ...aiResult.reviewAnalysis,
          reviewCount:    placesReviewCount,
          averageRating:  placesRating,
          reviewsPerWeek: 0,
          industryAverage: 4.2,
          responseRate:   '0%',
          positivePercent: 0,
          neutralPercent:  0,
          negativePercent: 0,
          estimatedFromPlaces: true,
        };
      } else {
        delete aiResult.reviewAnalysis;
      }

      aiResult.businessTier = targetTier;
      aiResult.competitors  = effectiveCompetitors;
      // Always persist local-pack competitors (even empty) so the report can
      // distinguish "not harvested" vs "none found". Prefer non-empty SerpApi
      // harvest; otherwise project Places competitors that have a rank.
      aiResult.localPackCompetitors = localPackCompetitors.length > 0
        ? localPackCompetitors
        : effectiveCompetitors
            .filter((c: any) => c.avgRank != null || c.estimatedRank != null)
            .map((c: any) => ({
              name: c.name,
              avgRank: c.avgRank ?? c.estimatedRank,
              rating: c.rating,
              reviewCount: c.reviewCount,
              placeId: c.placeId,
            }))
            .slice(0, 5);
      if (geoGridRank) aiResult.geoGridRank = geoGridRank;
      aiResult.evidence = {
        competitors:       compEvidence,
        searchRankings:    rankingsEvidence,
        profileCompletion: profileCompletionPayload.evidenceSource,
        reviewAnalysis:    hasReviewData
          ? reviewMetricsPayload.evidenceSource
          : hasPlacesSnapshot
            ? 'Rating & review count captured live from Google Places at report intake — full review-level detail (per-review sentiment, response rate) requires a review sync, not yet performed for this report.'
            : reviewMetricsPayload.evidenceSource,
        reviewKeywords:    reviewKeywordResult.evidenceSource,
      };

      if (!aiResult.profileScore) aiResult.profileScore = {};
      aiResult.profileScore.overallScore = finalScore;

      audit.auditVersion = 'V7';
      audit.overallScore = finalScore;
      audit.auditData    = aiResult;
      audit.status       = 'COMPLETED';
    }

    await audit.save();
    console.log(`[auditService] V7 audit completed: ${auditId} | score=${finalScore} | reviews=${formattedReviews.length}`);

    // Per-workspace subscription gate: this workspace's single free audit
    // report is now "generated" (COMPLETED, not just requested/PENDING). Mark
    // freeAuditUsed so further audits require an active subscription for this
    // workspace. Only flips workspaces that are not already subscribed.
    if (audit.status === 'COMPLETED') {
      try {
        await Business.updateOne(
          { _id: audit.businessId, subscriptionStatus: { $ne: 'active' } },
          { $set: { freeAuditUsed: true } }
        );
        // Admin sales pipeline: this workspace just experienced the product
        // for the first time — enter it as a 'Lead'. Only on businesses with
        // no stage yet, so this never overwrites one the admin already moved
        // forward (or the 'Customer' stage set on payment).
        await Business.updateOne(
          { _id: audit.businessId, pipelineStage: { $exists: false } },
          { $set: { pipelineStage: 'Lead' } }
        );
      } catch (gateErr) {
        console.error(`[auditService] Failed to update freeAuditUsed for business ${audit.businessId}:`, gateErr);
      }
    }

  } catch (error) {
    console.error(`[auditService] Failed audit ${auditId}:`, error);
    audit.status = 'FAILED';
    if (error instanceof Error) audit.metadata = { error: error.message };
    await audit.save();
    throw error;
  }
}
