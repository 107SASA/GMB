import crypto from 'crypto';
import dbConnect from '../../lib/mongodb';
import Audit from '../../models/Audit';
import Business from '../../models/Business';
import Review from '../../models/Review';
import PlaceInsightCache, { claimInsightRefresh, waitForInsightRefresh, IPlaceInsightCache } from '../../models/PlaceInsightCache';
import { generateAIAudit } from '../ai/auditEngine';
import { logAIUsage } from '../../lib/logAIUsage';

// googlePlaceId-keyed cache for fastMode (free-report / lead-gen) audits —
// see PlaceInsightCache.ts for why this is keyed by the real Google listing
// rather than our own Business._id, and why it's scoped to fastMode only.
//
// Rank has no cheap way to detect "did it actually change" (the only way to
// check is the DataForSEO call itself — the exact cost being avoided), so
// unlike narrative it can't be hash-invalidated; 7 days is a deliberately
// tighter TTL than narrative's 30 to bound how stale a number visitors will
// directly compare against reality can get.
const RANK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;       // DataForSEO + Places competitor search
const NARRATIVE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // Groq-authored narrative

// BUMP THIS whenever the logic that produces a cached rank/competitor or
// narrative result changes (keyword/category resolution, competitor
// relevance filtering, priority-fix Missing-vs-Unknown handling, the AI
// prompt, etc.) — TTL and inputsHash only catch "time passed" or "the
// underlying numbers changed"; neither catches "the code that turns those
// numbers into a result is now different code." Without this, a logic fix
// can be silently shadowed by its own now-wrong cached output for up to the
// full TTL window (this happened: Aug 2026, a generic-category keyword fix
// was invisible for ~40 minutes because the pre-fix cache was still within
// its 7-day TTL). A version bump makes every existing cache entry an
// instant, unconditional miss on next read, regardless of age.
// v2 (Aug 2026): resolveSearchCategory's name-derived fallback now appends
// a "company" qualifier — see seoAnalyzer.ts. Without this bump, the
// "technology kolkata" cache entries from v1 (which surfaced colleges
// instead of IT companies) would keep serving for up to 7 more days.
const CACHE_LOGIC_VERSION = 2;

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
    // fastMode (lead-gen entry points only, see src/lib/startAudit.ts) still
    // skips the first-time review sync (the slower of the two — a paginated
    // live fetch) but no longer skips geo-grid ranking outright: it runs a
    // reduced grid instead (1 keyword × ≤3 points, see fetchGeoGridRankings'
    // `reduced` option below) so a free report always has at least one real
    // rank number rather than an empty keywordRankings array. Paying
    // customers' audits (POST /api/audit, fastMode always false) are
    // unaffected either way; both steps already have honest "unavailable"
    // fallbacks for when DataForSEO credentials are missing, reused here
    // rather than adding new branches.
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
    // ── googlePlaceId-keyed cache (fastMode only) ──────────────────────
    // Two different leads asking about the SAME real Google listing
    // shouldn't each pay for a fresh DataForSEO grid + Places competitor
    // search + Groq call — the underlying facts are the same regardless of
    // who's asking. See PlaceInsightCache.ts for the full reasoning and why
    // this doesn't extend to paying customers' own dashboard audits.
    const googlePlaceId: string | undefined = businessForRankings.googlePlaceId;
    const cacheable = !!audit.fastMode && !!googlePlaceId;
    let insightCache = cacheable ? await PlaceInsightCache.findOne({ googlePlaceId }) : null;
    const isRankFresh = (c: IPlaceInsightCache | null | undefined) =>
      !!(
        c?.rank &&
        c.rank.logicVersion === CACHE_LOGIC_VERSION &&
        Date.now() - new Date(c.rank.fetchedAt).getTime() < RANK_CACHE_TTL_MS
      );
    let rankCacheFresh = isRankFresh(insightCache);
    // Dogpile guard: a plain findOne-then-later-write isn't atomic, so two
    // leads submitting within seconds of each other for the SAME place would
    // otherwise both see a miss and both pay for a fresh DataForSEO grid +
    // Places search. Only the request that wins the claim actually fetches;
    // the loser waits briefly for the winner's result instead of also
    // paying for its own (bounded — falls through to computing independently
    // if the winner doesn't finish in time, rather than hanging forever).
    let wonRankClaim = false;
    if (cacheable && !rankCacheFresh) {
      wonRankClaim = await claimInsightRefresh(googlePlaceId!, 'rank');
      if (!wonRankClaim) {
        const winnerResult = await waitForInsightRefresh(googlePlaceId!, 'rank', isRankFresh);
        if (winnerResult) {
          insightCache = winnerResult;
          rankCacheFresh = true;
        }
      }
    }

    const { dataForSeoConfigured } = require('./dataForSeoClient');
    const geoGridTask = rankCacheFresh
      ? Promise.resolve({
          legacyRankings:       insightCache!.rank!.legacyRankings,
          evidenceSource:       insightCache!.rank!.rankingsEvidence,
          geoGridRank:          insightCache!.rank!.geoGridRank,
          localPackCompetitors: insightCache!.rank!.localPackCompetitors,
        })
      : dataForSeoConfigured
        ? fetchGeoGridRankings(businessForRankings, { reduced: !!audit.fastMode })
        : Promise.resolve(null);

    // Competitor discovery (Google Places) only needs category/city/name/
    // website — none of which depend on the review sync above — so it runs
    // alongside it instead of waiting for it to finish first. reviewCount is
    // read from the reviews already in the DB (reviewsData, fetched before
    // this block); that's the real count except on a business's very first
    // audit, when it's 0 either way since nothing has synced yet.
    const { findCompetitors } = require('./competitorService');
    const competitorsTask = rankCacheFresh
      ? Promise.resolve({
          accepted:       insightCache!.rank!.accepted,
          rejected:       insightCache!.rank!.rejected,
          targetTier:     insightCache!.rank!.targetTier,
          evidenceSource: insightCache!.rank!.compEvidence,
        })
      : findCompetitors({
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

    // Geo-grid keyword rankings via DataForSEO (45 calls: 5 keywords × 9 grid
    // points for a full audit; 3 calls: 1 keyword × ≤3 points in fastMode —
    // see the `reduced` option on fetchGeoGridRankings above).
    let keywordRankings: any[] = [];
    let rankingsEvidence = 'Unavailable (DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD not configured)';
    let geoGridRank: any = null;
    let localPackCompetitors: any[] = [];

    if (rankData) {
      keywordRankings      = rankData.legacyRankings;
      rankingsEvidence     = rankData.evidenceSource;
      geoGridRank          = rankData.geoGridRank;
      localPackCompetitors = rankData.localPackCompetitors || [];
    } else {
      // Do NOT invent fake rank-21 keywords — surface unavailable honestly.
      keywordRankings = [];
      console.warn('[auditService] DataForSEO credentials missing — skipping live ranking & competitor harvest');
    }
    // rankSource for the dataQuality flag below — derived from what actually
    // ran rather than re-deriving audit.fastMode's meaning a second time.
    // 'error' (not just 'unavailable') means the DataForSEO call itself
    // failed — see rankData.fetchError / DataForSeoApiError — as opposed to
    // "not configured" or "queried successfully, found nothing." Confirmed
    // live Aug 2026: an unverified DataForSEO account (HTTP 403) produced
    // the exact same rank=21/no-competitors signal as a genuine "not
    // ranking nearby," indistinguishable without this.
    const rankSource: 'full-grid' | 'reduced-grid' | 'unavailable' | 'error' = !rankData
      ? 'unavailable'
      : rankData.fetchError
        ? 'error'
        : geoGridRank?.gridResolution === 'reduced'
          ? 'reduced-grid'
          : 'full-grid';

    // We hold the claim (wonRankClaim) — release it now regardless of
    // outcome, so a failed/empty result doesn't block the next request for
    // the full staleness window. Only write `rank` itself when there's real,
    // non-empty data to cache — NOT when the fetch itself failed (fetchError
    // set), since that's not a real "not found" answer and caching it for 7
    // days would keep serving a false negative long after the underlying
    // problem (e.g. an unverified account) might already be fixed.
    if (cacheable && wonRankClaim) {
      const releaseUpdate: any = { $unset: { rankPendingSince: '' } };
      if (rankData && !rankData.fetchError) {
        releaseUpdate.$set = {
          rank: {
            legacyRankings: keywordRankings,
            geoGridRank,
            localPackCompetitors,
            rankingsEvidence,
            accepted,
            rejected,
            targetTier,
            compEvidence,
            fetchedAt: new Date(),
            logicVersion: CACHE_LOGIC_VERSION,
          },
        };
      }
      await PlaceInsightCache.updateOne({ googlePlaceId }, releaseUpdate, { upsert: true })
        .catch((err: any) => console.warn('[auditService] Failed to release rank cache claim:', err.message));
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
    // Passing the Places snapshot lets calculateReviewMetrics itself return
    // the real reviewCount/averageRating when no reviews have synced yet
    // (fastMode), instead of every caller downstream needing its own
    // "unless we have a snapshot" branch — see seoAnalyzer.ts for the logic.
    const reviewMetricsPayload = calculateReviewMetrics(
      formattedReviews,
      hasPlacesSnapshot ? { rating: placesRating, reviewCount: placesReviewCount } : undefined,
    );

    const profileCompletion = profileCompletionPayload.data;
    const reviewMetrics     = reviewMetricsPayload.data;
    // The count actually displayed in the report's Review Analytics section
    // (real synced reviews, or — lacking those — the live Places snapshot).
    // Narrative generators (priority fixes, business intelligence) should
    // read off THIS, not formattedReviews.length, so they never say "0
    // reviews found" next to a nonzero count shown elsewhere in the same
    // report. Scoring (reviewQualityScore, keywordCoverageScore,
    // auditConfidence's per-review data-quality flag, finalScore) stays on
    // formattedReviews — those genuinely need real per-review detail
    // (rating distribution, sentiment, dates), which a snapshot's bare
    // count/rating can't provide, and are untouched by this.
    const effectiveReviewCount = reviewMetrics.reviewCount;

    const avgRank = keywordRankings.length > 0
      ? keywordRankings.reduce((acc: number, k: any) => acc + k.rank, 0) / keywordRankings.length
      : 0;
    const googleSearchRank = {
      averageRank: parseFloat(avgRank.toFixed(1)),
      topKeywords: keywordRankings,
    };

    // Aug 2026 correction: this used to prefer Places results filtered down
    // to whichever ones also name-matched the DataForSEO local-pack harvest
    // — which, now that DataForSEO is a live, working data source, produced
    // a SMALLER, differently-sourced set than localPackCompetitors itself
    // (Places textsearch and Maps local-pack search return overlapping but
    // not identical businesses even for the same keyword). The result: the
    // frontend's "N competitors ranking higher" headline (built from
    // localPackCompetitors directly) and businessIntelligence/priorityFixes
    // here (built from the filtered intersection) disagreed on the same
    // report — e.g. "10 competitors" next to "Low Market Saturation."
    //
    // Fix: prefer localPackCompetitors directly whenever it has data — it's
    // a real Maps search result (has actual avgRank, which Places never
    // does) AND it's the exact set already shown to the user, so scoring
    // stays consistent with what's displayed. Places `accepted` is now only
    // a fallback for when local-pack is empty (DataForSEO unconfigured, or
    // this specific keyword/location found nothing there) — the keyword fix
    // in resolveSearchCategory (seoAnalyzer.ts) already keeps that fallback
    // relevant on its own, so no separate cross-reference filter is needed.
    const effectiveCompetitors = localPackCompetitors.length > 0
      ? localPackCompetitors.map((c: any) => ({
          name: c.name,
          rating: c.rating || 0,
          reviewCount: c.reviewCount || 0,
          category: businessData.category,
          similarityScore: 80,
          tier: targetTier,
          avgRank: c.avgRank,
          estimatedRank: c.avgRank,
          placeId: c.placeId,
        }))
      : accepted;

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
      business, profileCompletion, effectiveReviewCount, effectiveCompetitors,
    );
    const businessIntelligence = calculateBusinessIntelligence(
      business, effectiveCompetitors, effectiveReviewCount,
    );

    // ── Scoring formula ────────────────────────────────────────
    // overallScore = profileCompletion.completionPercentage, full stop.
    //
    // Previously this blended profile 35% + SEO 25% + review quality 25% +
    // keyword coverage 15% into one number, shown at the top of the report
    // as "Google Profile Score". But the report ALSO shows a separate "Your
    // Profile Completion" section further down using the raw checklist
    // percentage — two different numbers for what every customer reads as
    // the same thing, and the composite one (which they see first, as the
    // big headline ring) doesn't match what "profile completion" actually
    // means. Per an explicit ask (Aug 2026) to stop that mismatch: the
    // headline score IS the completion percentage now, nothing else rolled
    // in. SEO score / review quality / keyword coverage remain fully
    // computed below and shown as their own separate sub-scores/insights in
    // the report (nativeSeoScore → aiResult.seoScore, reviewQualityScore +
    // keywordCoverageScore → audit.metadata.debug) — they're just no longer
    // blended into the one number customers treat as "my profile is X%
    // done."
    const hasReviewData = formattedReviews.length > 0;
    const finalScore = profileCompletion.completionPercentage;

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
    //
    // Narrative cache: the Groq-authored strengths/weaknesses/priority-fix
    // phrasing/action-plan is itself a real per-call cost, and it's a
    // function of the native numbers above (rank, reviews, competitors,
    // priority fixes) — not of who's asking. inputsHash captures exactly
    // those numbers, so even inside the 30-day TTL a genuine change (a new
    // review count, a rank move) forces regeneration rather than serving a
    // stale narrative about a business that's since changed.
    const narrativeInputs = {
      profileCompletionPct: profileCompletion.completionPercentage,
      reviewCount:          reviewMetrics.reviewCount,
      averageRating:        reviewMetrics.averageRating,
      avgRank:              googleSearchRank.averageRank,
      competitorNames:      effectiveCompetitors.map((c: any) => c.name).sort(),
      priorityFixTitles:    nativePriorityFixes.map((f: any) => f.title).sort(),
      actionPlanDurationDays,
    };
    const inputsHash = crypto.createHash('sha256').update(JSON.stringify(narrativeInputs)).digest('hex');
    const isNarrativeFresh = (c: IPlaceInsightCache | null | undefined) =>
      !!(
        c?.narrative &&
        c.narrative.logicVersion === CACHE_LOGIC_VERSION &&
        c.narrative.inputsHash === inputsHash &&
        Date.now() - new Date(c.narrative.fetchedAt).getTime() < NARRATIVE_CACHE_TTL_MS
      );
    let narrativeCacheFresh = cacheable && isNarrativeFresh(insightCache);
    // Same dogpile guard as the rank block above, for the Groq call.
    let wonNarrativeClaim = false;
    if (cacheable && !narrativeCacheFresh) {
      wonNarrativeClaim = await claimInsightRefresh(googlePlaceId!, 'narrative');
      if (!wonNarrativeClaim) {
        const winnerResult = await waitForInsightRefresh(googlePlaceId!, 'narrative', isNarrativeFresh);
        if (winnerResult) {
          insightCache = winnerResult;
          narrativeCacheFresh = true;
        }
      }
    }

    const auditStartMs = Date.now();
    let aiResult: any;
    if (narrativeCacheFresh) {
      const f = insightCache!.narrative!.aiFields;
      aiResult = {
        profileScore:       f.profileScore,
        keywordGapAnalysis: f.keywordGapAnalysis,
        reviewAnalysis:     { ...f.reviewAnalysisNarrative },
        strengths:          f.strengths,
        weaknesses:         f.weaknesses,
        priorityFixes:      f.priorityFixes,
        thirtyDayPlan:      f.thirtyDayPlan,
        ninetyDayPlan:      f.ninetyDayPlan,
        actionPlan:         f.actionPlan,
        _usage:             { promptTokens: 0, completionTokens: 0 },
      };
    } else {
      aiResult = await generateAIAudit(enrichedBusinessData, { actionPlanDurationDays });
      if (aiResult === 'Data Unavailable') throw new Error('Data Unavailable');

      // No real Groq usage on a cache hit — logging it as 'success' with 0
      // tokens would just be noise in cost/usage analytics.
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
    }

    // ── Merge native truths over AI output ───────────────────
    if (typeof aiResult === 'object') {
      aiResult.googleSearchRank    = googleSearchRank;
      aiResult.profileCompletion   = profileCompletion;
      aiResult.seoScore            = nativeSeoScore;
      aiResult.auditConfidence     = auditConfidence;
      aiResult.businessIntelligence = businessIntelligence;

      // No real reviews synced AND no live Places snapshot — omit the
      // section entirely rather than merging in a hollow "0 reviews, 0
      // rating" block that would misleadingly read as a real finding.
      // AuditReportGrexa / the free-report page check for this and skip
      // rendering the section.
      //
      // Otherwise, reviewMetrics is already the single source of truth for
      // what to show — calculateReviewMetrics(formattedReviews, snapshot) in
      // seoAnalyzer.ts returns real synced numbers when they exist, or the
      // Places snapshot's real reviewCount/averageRating (with only the
      // per-review-dependent fields — reviews/week, response rate, sentiment
      // split — flagged in estimatedFields, since Places doesn't expose
      // those) when they don't. Scoring is untouched: hasReviewData (used
      // for reviewQualityScore/keywordCoverageScore/finalScore above) is
      // still driven only by formattedReviews, not this fallback.
      if (hasReviewData || hasPlacesSnapshot) {
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
          ...(hasReviewData
            ? {}
            : { estimatedFromPlaces: true, estimatedFields: (reviewMetrics as any).estimatedFields }),
        };
      } else {
        delete aiResult.reviewAnalysis;
      }

      // The prompt tells the AI "priorityFixes MUST perfectly match
      // IDENTIFIED NATIVE PRIORITY FIXES" — but confirmed live (Aug 2026):
      // when that native list is genuinely empty (nothing to fix), the AI
      // sometimes invents a placeholder entry ("No priority fixes
      // identified") instead of returning an empty array. That placeholder
      // then gets counted as a real issue in the free-report page's
      // issuesCount stat, making "nothing to fix" look like "+1 problem."
      // Enforced here rather than trusted to the prompt — nativePriorityFixes
      // is the actual source of truth either way.
      aiResult.priorityFixes = nativePriorityFixes.length > 0 ? aiResult.priorityFixes : [];

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
            .slice(0, 10); // matches the raised cap in seoAnalyzer.ts's own localPackCompetitors aggregation
      if (geoGridRank) aiResult.geoGridRank = geoGridRank;
      aiResult.evidence = {
        competitors:       compEvidence,
        searchRankings:    rankingsEvidence,
        profileCompletion: profileCompletionPayload.evidenceSource,
        // reviewMetricsPayload.evidenceSource is already snapshot-aware (see
        // seoAnalyzer.ts) — no need to re-derive the "estimated from Places"
        // wording here a second time.
        reviewAnalysis:    reviewMetricsPayload.evidenceSource,
        reviewKeywords:    reviewKeywordResult.evidenceSource,
      };

      // Single flag object naming which real source powered the rank and
      // review numbers in this report, so the frontend (and any future
      // debugging) can tell "reduced but real" apart from "estimated from a
      // snapshot" apart from "genuinely unavailable" without reverse-
      // engineering it from which fields happen to be zero. rankCacheHit /
      // narrativeCacheHit make the googlePlaceId cache's effect visible too,
      // rather than being invisible plumbing.
      aiResult.dataQuality = {
        rankSource,
        reviewSource: hasReviewData ? 'live-sync' : hasPlacesSnapshot ? 'places-snapshot' : 'unavailable',
        rankCacheHit: rankCacheFresh,
        narrativeCacheHit: narrativeCacheFresh,
      };

      if (!aiResult.profileScore) aiResult.profileScore = {};
      aiResult.profileScore.overallScore = finalScore;

      audit.auditVersion = 'V7';
      audit.overallScore = finalScore;
      audit.auditData    = aiResult;
      audit.status       = 'COMPLETED';

      // We hold the claim (wonNarrativeClaim) — release it now under the
      // inputs this narrative was written about, so the next lead asking
      // about the same googlePlaceId with the same underlying numbers gets
      // it for free instead of re-generating identical prose.
      if (cacheable && wonNarrativeClaim) {
        await PlaceInsightCache.updateOne(
          { googlePlaceId },
          {
            $set: {
              narrative: {
                inputsHash,
                aiFields: {
                  profileScore:       aiResult.profileScore,
                  keywordGapAnalysis: aiResult.keywordGapAnalysis,
                  reviewAnalysisNarrative: {
                    mostCommonPraises:    aiResult.reviewAnalysis?.mostCommonPraises    || [],
                    mostCommonComplaints: aiResult.reviewAnalysis?.mostCommonComplaints || [],
                  },
                  strengths:     aiResult.strengths,
                  weaknesses:    aiResult.weaknesses,
                  priorityFixes: aiResult.priorityFixes,
                  thirtyDayPlan: aiResult.thirtyDayPlan,
                  ninetyDayPlan: aiResult.ninetyDayPlan,
                  actionPlan:    aiResult.actionPlan,
                },
                fetchedAt: new Date(),
                logicVersion: CACHE_LOGIC_VERSION,
              },
            },
            $unset: { narrativePendingSince: '' },
          },
          { upsert: true },
        ).catch((err: any) => console.warn('[auditService] Failed to release narrative cache claim:', err.message));
      }
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
