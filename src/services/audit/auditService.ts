import dbConnect from '../../lib/mongodb';
import Audit from '../../models/Audit';
import Business from '../../models/Business';
import Review from '../../models/Review';
import User from '../../models/User';
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

    // Fetch real reviews — cap at MAX_REVIEWS_PER_AUDIT (default 100)
    const maxReviews = parseInt(process.env.MAX_REVIEWS_PER_AUDIT || '100', 10);
    let reviewsData = await Review.find({ businessId: business._id, ...reviewDateFilter })
      .sort({ postedAt: -1, createdAt: -1 })
      .limit(maxReviews);

    // Auto-sync from SerpApi if no reviews in DB yet (for the selected period)
    if (reviewsData.length === 0 && process.env.SERPAPI_KEY) {
      console.log(`[auditService] No reviews in DB for businessId=${audit.businessId} in the last ${reviewPeriodDays}d — attempting live fetch`);
      try {
        const { syncReviewsForBusiness } = require('../reviews/syncReviews');
        const tenantId = business.organizationId?.toString() || audit.tenantId;
        await syncReviewsForBusiness(business._id.toString(), tenantId);
        reviewsData = await Review.find({ businessId: business._id, ...reviewDateFilter })
          .sort({ postedAt: -1, createdAt: -1 })
          .limit(maxReviews);
        console.log(`[auditService] Auto-synced ${reviewsData.length} reviews for ${business.name} within the last ${reviewPeriodDays}d`);
      } catch (syncErr: any) {
        console.warn(`[auditService] Review auto-sync failed: ${syncErr.message}`);
      }
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

    // ── Business data payload for analyzers ───────────────────
    // Extract city from address if the city field was not explicitly set.
    // Indian address format: "..., Area, City, State PostalCode, Country"
    // → city is typically the 3rd segment from the end.
    // audit.userDefinedCategory / audit.city are set from the form overrides at job creation time
    const resolvedCity = audit.city || business.city || (() => {
      if (!business.address) return '';
      const parts = business.address.split(',').map((p: string) => p.trim()).filter(Boolean);
      return parts.length >= 3 ? (parts[parts.length - 3] || '') : (parts[parts.length - 1] || '');
    })();

    const businessData = {
      businessName:   business.name,
      category:       audit.userDefinedCategory || business.userDefinedCategory || business.category || 'Local Business',
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

    if (formattedReviews.length > 0) {
      const sum = formattedReviews.reduce((acc, r) => acc + r.rating, 0);
      businessData.rating = parseFloat((sum / formattedReviews.length).toFixed(1));
    }

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

    const profileCompletionPayload = calculateProfileCompletion(business);
    const reviewMetricsPayload     = calculateReviewMetrics(formattedReviews);

    const profileCompletion = profileCompletionPayload.data;
    const reviewMetrics     = reviewMetricsPayload.data;

    // Geo-grid keyword rankings via SerpApi (45 calls: 5 keywords × 9 grid points)
    let keywordRankings: any[] = [];
    let rankingsEvidence = 'Fallback (no SERPAPI_KEY)';
    let geoGridRank: any = null;
    let localPackCompetitors: any[] = [];

    if (process.env.SERPAPI_KEY) {
      // Augment business with the resolved category + city so geo-grid keywords
      // are correct even when the stored business profile has no category set.
      const businessForRankings = {
        ...(typeof business.toObject === 'function' ? business.toObject() : business),
        category: businessData.category,
        city:     businessData.city,
      };
      const rankData       = await fetchGeoGridRankings(businessForRankings);
      keywordRankings      = rankData.legacyRankings;
      rankingsEvidence     = rankData.evidenceSource;
      geoGridRank          = rankData.geoGridRank;
      localPackCompetitors = rankData.localPackCompetitors;
    } else {
      keywordRankings = [
        { keyword: `${businessData.category} ${business.city}`, rank: 21 },
        { keyword: `best ${businessData.category}`,             rank: 21 },
      ];
    }

    const avgRank = keywordRankings.reduce((acc: number, k: any) => acc + k.rank, 0) /
      (keywordRankings.length || 1);
    const googleSearchRank = {
      averageRank: parseFloat(avgRank.toFixed(1)),
      topKeywords: keywordRankings,
    };

    // ── Competitor discovery ───────────────────────────────────
    const { findCompetitors } = require('./competitorService');
    const { accepted, rejected, targetTier, evidenceSource: compEvidence } =
      await findCompetitors(businessData);

    // When tier-matched competitor discovery returns nothing, fall back to
    // the local pack competitors already harvested from the geo-grid queries.
    // This ensures the web UI always shows competitor data when geo-grid worked.
    const effectiveCompetitors = accepted.length > 0
      ? accepted
      : localPackCompetitors.map((c: any) => ({
          name: c.name,
          rating: c.rating || 0,
          reviewCount: c.reviewCount || 0,
          category: businessData.category,
          similarityScore: 60,
          tier: targetTier,
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
    const finalScore = Math.round(Math.min(100,
      profileCompletion.completionPercentage * 0.35 +
      nativeSeoScore.score                  * 0.25 +
      reviewQualityScore                    * 0.25 +
      keywordCoverageScore                  * 0.15,
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

      aiResult.businessTier = targetTier;
      aiResult.competitors  = effectiveCompetitors;
      if (geoGridRank)                  aiResult.geoGridRank          = geoGridRank;
      if (localPackCompetitors.length)  aiResult.localPackCompetitors = localPackCompetitors;
      aiResult.evidence = {
        competitors:       compEvidence,
        searchRankings:    rankingsEvidence,
        profileCompletion: profileCompletionPayload.evidenceSource,
        reviewAnalysis:    reviewMetricsPayload.evidenceSource,
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

    // Feature 1 — freemium gate: the user's single free audit report is now
    // "generated" (COMPLETED, not just requested/PENDING). Only ever
    // touches users who have freemiumAuditGate.active set (brand-new
    // signups) — existing users are untouched by this update.
    if (audit.status === 'COMPLETED') {
      try {
        await User.findOneAndUpdate(
          { _id: audit.userId, 'freemiumAuditGate.active': true },
          { $set: { 'freemiumAuditGate.auditUsed': true, 'freemiumAuditGate.auditId': audit._id } }
        );
      } catch (gateErr) {
        console.error(`[auditService] Failed to update freemiumAuditGate for user ${audit.userId}:`, gateErr);
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
