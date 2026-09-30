import crypto from 'crypto';
import dbConnect from '../../lib/mongodb';
import Audit from '../../models/Audit';
import Business from '../../models/Business';
import Review from '../../models/Review';
import PlaceInsightCache, { claimInsightRefresh, waitForInsightRefresh, IPlaceInsightCache } from '../../models/PlaceInsightCache';
import { generateAIAudit, type AuditAIResult } from '../ai/auditEngine';
import {
  buildReviewFacts,
  compareReviews,
  competitorsAhead,
  competitorsFromObservations,
  compareCompetitors,
  brandPhrase,
  publicProfileFromObservations,
  gridFromObservations,
  isBrandedKeyword,
  profileFieldStates,
  summarizeByKeyword,
  summarizeRankings,
  suspensionRiskHeuristic,
  type CompetitorFact,
  type LifetimeReviewInput,
  type SearchObservation,
} from './facts';
import { buildEvidenceAndFindings, isCustomerIssue, selectOpportunities, type KeywordRow } from './findings';
import { validateAudit, repairUnverifiedGbpClaims, type ValidatableAudit } from './validateAudit';
import { getWebsiteIntelligence } from '../intel/websiteIntelligence';
import { keywordSource, pickServiceForSearch, toSearchPhrase, websiteServiceKeywords } from '../intel/searchTerms';
import { evidenceState, findingExecution, isVerifiedIssue } from './findings';
import { auditKindOf, buildOptimizationPlan, compareAudits, type ComparableSnapshot } from './optimizationPlan';
import { UNIT_PRICES } from './costModel';
import { collectExecutions } from '../lifecycle/collect';
import { syncOptimizationActions } from '../lifecycle/actionsSync';
import { buildMonthlyReport } from '../lifecycle/monthly';
import { currentMeter, currentMeterReasons, meter, mergeIntoMeter, providerCallLines, runWithMeter } from '../../lib/providerMeter';
import { logAIUsage } from '../../lib/logAIUsage';
import { GROQ_MODEL } from '../../lib/aiModel';

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
// v3 (Aug 2026): competitorService.ts's findCompetitors now real-derives
// each candidate's category from its own Places types (was: hardcoded to
// copy the target's own category onto every row) and applies an actual
// relevance filter (type-to-type, or label-word when the target's types
// aren't known) instead of accepting whatever Places textsearch returned
// unfiltered. Confirmed live: exactly the same failure this comment already
// describes — a real free-report ("Desun Academy") kept showing unrelated
// competitors (Urban Company, TCS, a Kolkata immigration consultancy) after
// the fix shipped, because the pre-fix cache entry was still inside its
// 7-day TTL and this version bump was missed at the time.
// v4 (Aug 2026): found the actual root cause of that same Desun Academy
// case — resolveSearchCategory's name-derived fallback picked "Kolkata"
// (the trailing word in "...Institute in Kolkata") as the search keyword,
// since it only ever looked at the raw trailing word(s) of the name with no
// awareness that one of them was the business's own city. Search query was
// literally "kolkata company" — zero topical signal, matches any company in
// the city, which is why v3's relevance filter had nothing real to compare
// against and silently fell back to "no filter" for every candidate.
// resolveSearchCategory now strips the business's own city/area/state out
// of the name before deriving a keyword from what's left.
// v5 (Aug 2026): the geo-grid competitor harvest's "target not found at
// this point" fallback raised from top-5 to top-10 (seoAnalyzer.ts) — a
// real business with an averaged rank in the teens (found at one grid
// point, not-found at the other two) was only showing ~4 named competitors
// in the table, visibly out of proportion with what the rank number
// implied. More of the same real, already-fetched data, not new data.
// v6 (Sep 2026): profile completion now carries a qualified label/prompt
// fact (places vs oauth field groups — see src/lib/profileCompletion.ts)
// and the Groq prompt is fed that fact instead of a bare "100%". Old
// narratives cached under v5 still say "Full Profile Completion — 100%
// profile completion" / "profile is 100% complete"; this bump forces them
// to regenerate. The consultant SEO-plan sections also land at this
// version.
// v7 (Sep 2026): the free-report keyword table + areas-checked list are now
// stored in the rank cache blob (previously recomputed on every hit,
// wasting ~$0.13 of Maps + Keyword Planner + Geocoding per repeat lookup).
// Pre-v7 rank entries have no keywordTable, so they must regenerate once.
// v8 (Sep 2026): the audit-engine correctness pass. Rank blobs now carry
// per-search `observations` (facts.ts: not-found = null, provider failure =
// unavailable) and competitors are derived from them; narratives are built
// from evidence-backed findings. Every pre-v8 entry holds numbers computed
// with the 21 sentinel and AI text written without evidence — none of it may
// be served again.
// v9 (Sep 2026): website intelligence feeds the search terms (generic
// categories use a service the website names), keyword rows carry a source,
// and competitor listing fields + comparison are stored. v8 blobs lack them.
// v10 (Sep 2026): observations keep below-target businesses (competitor
// appearances + relevance), top-10 counts, no title word-count heuristic,
// invented-business/service validation on AI text. v9 narratives may carry
// "long title" findings and unvalidated names.
// v11 (Sep 2026): verification-only findings (not issues), "near me" demand
// phrase in free reports, competitor tier labels, nationwide-demand wording,
// honest unknown review count in business intelligence.
const CACHE_LOGIC_VERSION = 11;

/** How recently a review sync must have refreshed Google's totals for the
 *  analysis window to count as synced (the Inngest pre-sync runs minutes
 *  before this job). */
const RECENT_SYNC_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Runs one audit inside a provider meter, so auditData.providerUsage holds the
 * external calls this audit actually made (not an estimate).
 */
export async function processAuditJob(auditId: string) {
  return (await runWithMeter(() => processAuditJobInner(auditId))).result;
}

async function processAuditJobInner(auditId: string) {
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

    // Feature 2A — Review Analysis Range Selector: the RECENT window only
    // (new reviews, velocity, response rate, sentiment). Lifetime totals come
    // from Google directly (see lifetime below) and are never derived from
    // this window.
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

    // The Inngest pre-sync-reviews step (non-fastMode) already synced
    // reviews right before this job — processAuditJob is only ever called
    // from that function — so there is no second sync here (the old in-job
    // fallback paid SerpApi again whenever the window happened to be empty).
    const maxReviews = parseInt(process.env.MAX_REVIEWS_PER_AUDIT || '50', 10);
    const reviewsData = await Review.find({ businessId: business._id, ...reviewDateFilter })
      .sort({ postedAt: -1, createdAt: -1 })
      .limit(maxReviews);

    // Extract city from address if the city field was not explicitly set.
    // Indian address format: "..., Area, City, State PostalCode, Country"
    // → city is typically the 3rd segment from the end.
    const resolvedCity = audit.city || business.city || (() => {
      if (!business.address) return '';
      const parts = business.address.split(',').map((p: string) => p.trim()).filter(Boolean);
      return parts.length >= 3 ? (parts[parts.length - 3] || '') : (parts[parts.length - 1] || '');
    })();
    const resolvedCategory = audit.userDefinedCategory || business.userDefinedCategory || business.category || 'Local Business';

    const {
      calculateProfileCompletion,
      calculateReviewMetrics,
      calculateReviewQualityScore,
      analyzeReviewKeywords,
      fetchGeoGridRankings,
      calculateNativeSeoScore,
      calculateAuditConfidence,
      calculateBusinessIntelligence,
      findSelfPraiseTerm,
    } = require('./seoAnalyzer');

    const businessObj = typeof business.toObject === 'function' ? business.toObject() : business;

    // ── Website intelligence (crawl once, cached 30 days, reused everywhere) ─
    // Runs before ranking: the services a website states are the best search
    // terms when Google lists only a generic category. Every item is a
    // SOURCE_CLAIM (what the site says) with its page URL. A failed crawl
    // never fails the report.
    let websiteIntel: any = null;
    if (business.website) {
      try {
        websiteIntel = await getWebsiteIntelligence(business.website, { maxPages: 6 });
      } catch (wiErr: any) {
        console.warn('[auditService] website intelligence failed:', wiErr?.message);
      }
    }
    const websiteServices: string[] = (websiteIntel?.services || []).map((c: any) => String(c.value));
    const { resolveSearchCategory: resolveCat } = require('./seoAnalyzer');
    const categorySearchable = !!resolveCat(resolvedCategory, business.name, [resolvedCity, business.area, business.state]);
    // Generic Google category (e.g. "Services") → search for the service the
    // website itself names, labelled 'website_service' in the report.
    const websiteSearchTerm: string | null = !categorySearchable ? pickServiceForSearch(websiteServices) : null;
    // What is actually sent to Google ("AI & Automation" → "ai and automation").
    const websiteSearchPhrase: string | null = websiteSearchTerm ? toSearchPhrase(websiteSearchTerm) : null;
    const ownerTerms: string[] = [
      ...String(business.services || '').split(/[,;\n]+/).map((x: string) => x.trim()),
      ...(business.intakeCompleted && Array.isArray(business.keywords) ? business.keywords : []),
    ].filter(Boolean);

    const businessForRankings = {
      ...businessObj,
      name: businessObj.name || business.name,
      category: websiteSearchPhrase || resolvedCategory,
      ...(websiteSearchPhrase
        ? {
            keywords: Array.from(new Set([websiteSearchPhrase, ...websiteServices.map(toSearchPhrase)])).filter(Boolean).slice(0, 3),
            services: websiteServices.slice(0, 4).join(', '),
          }
        : {}),
      city:     resolvedCity,
      placeId: businessObj.placeId || businessObj.googlePlaceId,
      googlePlaceId: businessObj.googlePlaceId || businessObj.placeId,
      serpApiDataId: businessObj.serpApiDataId || businessObj.dataId,
    };

    // ── googlePlaceId-keyed cache (fastMode only) ──────────────────────
    // Two different leads asking about the SAME real Google listing
    // shouldn't each pay for a fresh DataForSEO grid + keyword expansion +
    // Groq call. See PlaceInsightCache.ts.
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
    const cachedRank: any = rankCacheFresh ? insightCache!.rank : null;
    if (cachedRank) meter('rankCacheHit', 1, 'rank_blob_reused (7 days)');

    // ── Ranking (DataForSEO) ───────────────────────────────────────────
    // 5 keywords × 9 grid points for a full audit; 1 keyword × ≤3 points in
    // fastMode. Not configured → no observations → ranking "not run", which
    // every surface shows as unavailable (never as "not found").
    const { dataForSeoConfigured } = require('./dataForSeoClient');
    const rankData: any = cachedRank
      ? null
      : dataForSeoConfigured
        ? await fetchGeoGridRankings(businessForRankings, { reduced: !!audit.fastMode })
        : null;
    if (!cachedRank && !rankData) {
      console.warn('[auditService] DataForSEO credentials missing — ranking unavailable for this audit');
    }

    let observations: SearchObservation[] = cachedRank ? (cachedRank.observations || []) : (rankData?.observations || []);
    let areasChecked: string[] = cachedRank ? (cachedRank.areasChecked || []) : [];
    // Grid metadata only (resolution/spacing/area) — ranks live in observations.
    const gridMeta: { gridResolution?: 'full' | 'reduced'; gridSpacingKm?: number; areaSqKm?: number } | null = cachedRank
      ? cachedRank.gridMeta ?? null
      : rankData
        ? { gridResolution: rankData.gridResolution, gridSpacingKm: rankData.gridSpacingKm, areaSqKm: rankData.areaSqKm }
        : null;
    const rankingsEvidence: string = cachedRank
      ? cachedRank.rankingsEvidence
      : rankData?.evidenceSource || 'Unavailable (DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD not configured)';

    // ── fastMode keyword expansion: hyper-local phrases, one check each ──
    if (!cachedRank && audit.fastMode && rankData && !rankData.fetchError) {
      try {
        const { fetchNearbyLocalities } = require('./localities');
        const { buildFreeReportKeywords } = require('./keywordSeeds');
        const { fetchKeywordRankSnapshot } = require('./seoAnalyzer');

        const localities = await fetchNearbyLocalities(businessForRankings.coordinates, { limit: 8 });
        const seeded = buildFreeReportKeywords(
          { ...businessForRankings, city: resolvedCity, category: websiteSearchPhrase || resolvedCategory },
          localities.neighbourhoods,
        );
        // Up to 3 services the website states, searched city-wide (+3 tasks).
        for (const kw of websiteServiceKeywords(websiteServices, resolvedCity, 3)) {
          if (!seeded.keywords.some((k: string) => k.toLowerCase() === kw)) seeded.keywords.push(kw);
        }
        areasChecked = seeded.areasUsed.length ? seeded.areasUsed : localities.neighbourhoods;
        const areaWords = areasChecked.map((a: string) => a.toLowerCase());

        // Skip phrases the grid already searched — no paying twice.
        const already = new Set(observations.map((o) => o.keyword.toLowerCase()));
        const toCheck = seeded.keywords.filter((k: string) => !already.has(k.toLowerCase()));
        const snapshot = await fetchKeywordRankSnapshot(businessForRankings, toCheck, {
          kindOf: (kw: string) => (areaWords.some((a) => kw.toLowerCase().includes(a)) ? 'nearby' : 'discovery'),
        });
        observations = [...observations, ...snapshot.map((r: any) => r.observation)];
      } catch (seedErr: any) {
        console.warn('[auditService] free-report keyword expansion failed:', seedErr?.message);
      }
    }

    // ── Branded searches ───────────────────────────────────────────────
    // A search containing the business's own name measures brand lookups,
    // not visibility — shown, but excluded from every statistic below.
    const { resolveSearchCategory } = require('./seoAnalyzer');
    const searchCategory: string = resolveSearchCategory(websiteSearchPhrase || resolvedCategory, business.name, [resolvedCity, business.area, business.state]);
    observations = observations.map((o) =>
      isBrandedKeyword(o.keyword, business.name, searchCategory) ? { ...o, kind: 'brand' as const } : o,
    );
    const marketObs = observations.filter((o) => o.kind !== 'brand');
    // Nothing measurable: no usable category (and no owner keywords), so no
    // customer search term exists — "not measured", never brand-name ranks.
    const rankingNotRunReason: 'category_unknown' | null =
      rankData?.notRunReason === 'category_unknown' || (!searchCategory && marketObs.length === 0 && !rankData?.fetchError)
        ? 'category_unknown'
        : null;

    // ── Facts: ranking ─────────────────────────────────────────────────
    const primaryObs = marketObs.filter((o) => o.kind === 'primary');
    const nearbyObs = observations.filter((o) => o.kind === 'nearby');
    const rankingFacts = {
      overall: summarizeRankings(marketObs),
      primary: summarizeRankings(primaryObs),
      nearby: summarizeRankings(nearbyObs),
      discovery: summarizeRankings(observations.filter((o) => o.kind === 'discovery')),
      byKeyword: summarizeByKeyword(observations),
      primaryKeyword: primaryObs[0]?.keyword || marketObs[0]?.keyword || null,
      notRunReason: rankingNotRunReason,
      brandSearches: summarizeRankings(observations.filter((o) => o.kind === 'brand')),
    };
    const rankSource: 'full-grid' | 'reduced-grid' | 'unavailable' | 'error' =
      rankingFacts.overall.status === 'not_run'
        ? 'unavailable'
        : rankingFacts.overall.status === 'unavailable'
          ? 'error'
          : gridMeta?.gridResolution === 'reduced' ? 'reduced-grid' : 'full-grid';
    // ── Facts: competitors (real businesses observed above the target) ──
    let competitorFacts: CompetitorFact[] = competitorsFromObservations(marketObs);
    const aheadFacts = competitorsAhead(marketObs);

    // Places Text Search is a FALLBACK only (Sep 2026): it used to run on
    // every audit (~$0.096) and its result was discarded whenever the Maps
    // results above already had competitors — the usual case.
    let compEvidence = `Real Google Maps results above the business across ${aheadFacts.searchesChecked} searches (DataForSEO)`;
    let placesFallback: any[] = cachedRank?.placesFallback || [];
    if (!cachedRank && competitorFacts.length === 0) {
      const { findCompetitors } = require('./competitorService');
      const res = await findCompetitors({
        businessName: business.name,
        // Same search term as the ranking (a website service when Google's
        // category is generic) — else a generic category refuses to search.
        category:     websiteSearchPhrase || resolvedCategory,
        city:         resolvedCity,
        area:         business.area    || '',
        state:        business.state   || '',
        country:      business.country || '',
        website:      business.website || '',
        reviewCount:  0,
        googleTypes:  business.googleTypes,
      });
      placesFallback = res.accepted || [];
      compEvidence = `${res.evidenceSource} (fallback — no ranking results available)`;
    } else if (cachedRank && competitorFacts.length === 0 && placesFallback.length) {
      compEvidence = 'Google Places search (fallback — no ranking results available)';
    }
    if (competitorFacts.length === 0 && placesFallback.length) {
      competitorFacts = placesFallback.map((c: any) => ({
        key: `name:${String(c.name).toLowerCase()}`,
        name: c.name,
        placeId: c.placeId || null,
        cid: null,
        category: c.category || null,
        address: c.address || null,
        rating: typeof c.rating === 'number' && c.rating > 0 ? c.rating : null,
        reviewCount: typeof c.reviewCount === 'number' ? c.reviewCount : null,
        searchesAhead: 0,
        aheadRate: null,
        averageObservedRank: null,
        bestObservedRank: null,
        top5Count: 0,
        top3Count: 0,
        keywords: [],
        website: null,
        phone: null,
        additionalCategories: null,
        hasHours: null,
        bookingUrl: null,
        isClaimed: null,
        appearances: null,
        relevance: 'unmeasured' as const,
        source: 'google_places' as const,
        similarityScore: null,
      }));
    }

    // ── Keyword table (demand band + measured rank per phrase) ──────────
    let keywordTable: any[] = cachedRank ? (cachedRank.keywordTable || []) : [];
    if (!cachedRank && rankingFacts.byKeyword.some((k) => k.kind !== 'brand')) {
      try {
        const { buildKeywordTable } = require('./keywordTable');
        keywordTable = await buildKeywordTable(
          rankingFacts.byKeyword.filter((k) => k.kind !== 'brand').map((k) => ({
            keyword: k.keyword,
            rank: k.averageObservedRank,
            found: k.foundCount > 0,
            status: k.status === 'unavailable' ? 'unavailable' as const : 'ok' as const,
          })),
          { city: resolvedCity, area: business.area || '', country: business.country || '' },
        );
      } catch (kwErr: any) {
        console.warn('[auditService] keyword table build failed:', kwErr?.message);
      }
    }

    // Release the rank claim; only cache real data (never a failed fetch).
    if (cacheable && wonRankClaim) {
      const releaseUpdate: any = { $unset: { rankPendingSince: '' } };
      if (rankData && !rankData.fetchError) {
        releaseUpdate.$set = {
          rank: {
            observations,
            gridMeta,
            rankingsEvidence,
            placesFallback,
            keywordTable,
            areasChecked,
            fetchedAt: new Date(),
            logicVersion: CACHE_LOGIC_VERSION,
          },
        };
      }
      await PlaceInsightCache.updateOne({ googlePlaceId }, releaseUpdate, { upsert: true })
        .catch((err: any) => console.warn('[auditService] Failed to release rank cache claim:', err.message));
    }

    // ── Facts: reviews (lifetime vs recent window) ──────────────────────
    const formattedReviews = reviewsData.map(r => ({
      author:        r.reviewer     || 'Anonymous',
      rating:        r.rating       || 0,
      text:          r.reviewText   || '',
      date:          (r.postedAt ?? r.createdAt)?.toISOString() || new Date().toISOString(),
      ownerReply:    (r as any).response || r.replyText,
      // true / false only when a sync actually read the reply state.
      hasReply:      (r as any).response || r.replyText ? true : (r as any).replyCheckedAt ? false : null,
      sentiment:     r.sentiment    || 'neutral',
      sentimentScore: r.sentimentScore || 0,
    }));

    const totals: any = (businessObj as any).googleReviewTotals;
    const placesReviewCount = typeof business.placesReviewCount === 'number' ? business.placesReviewCount : undefined;
    const placesRating      = typeof business.placesRating === 'number' ? business.placesRating : undefined;
    const lifetimeInput: LifetimeReviewInput | null =
      totals && typeof totals.count === 'number'
        ? { count: totals.count, rating: totals.rating ?? null, source: totals.source }
        : placesReviewCount != null
          ? { count: placesReviewCount, rating: placesRating ?? null, source: 'google_places' }
          : null;
    const recentSynced = !audit.fastMode && !!totals?.capturedAt &&
      Date.now() - new Date(totals.capturedAt).getTime() < RECENT_SYNC_WINDOW_MS;
    const reviewFacts = buildReviewFacts(lifetimeInput, {
      periodDays: reviewPeriodDays,
      synced: recentSynced,
      reviews: formattedReviews.map((r) => ({ rating: r.rating, hasReply: r.hasReply, sentiment: r.sentiment, text: r.text })),
    });
    const lifetimeCount = reviewFacts.lifetime.totalCount;
    const effectiveReviewCount = lifetimeCount ?? 0;
    // Only businesses actually observed above the target — Places-fallback
    // competitors were never seen ranking above it.
    const reviewComparison = compareReviews(reviewFacts, competitorFacts.filter((c) => c.source === 'dataforseo'));

    // ── Competitor intelligence ─────────────────────────────────────────
    // Public listing fields come free with the ranking results. Website
    // research is selective: only the 3 competitors seen above the target
    // most often, 2 pages each, cached per domain (HTTP only — no paid API).
    const publicProfile = publicProfileFromObservations(observations);
    // Up to 5 candidates in parallel (some sites fail DNS/TLS); the first 3
    // that answer, in order of how often they were above the target, are used.
    const candidates = competitorFacts.filter((c) => c.source === 'dataforseo' && c.website).slice(0, 5);
    const reads = await Promise.all(candidates.map((c) =>
      getWebsiteIntelligence(c.website, { maxPages: 2 }).catch(() => null)));
    let researchedCount = 0;
    candidates.forEach((c, i) => {
      const intel = reads[i];
      if (researchedCount >= 3 || !intel || intel.status === 'failed') return;
      researchedCount++;
      (c as any).websiteServices = (intel.services || []).slice(0, 8).map((x: any) => x.value);
      (c as any).websiteSourceUrl = intel.pagesCrawled?.[0]?.url || c.website;
    });
    const competitorComparison = compareCompetitors(competitorFacts, {
      rating: reviewFacts.lifetime.rating,
      reviewCount: reviewFacts.lifetime.totalCount,
      profile: publicProfile,
      ranking: rankingFacts.overall,
    });

    // Size tier from the LIFETIME count (was the 14-day window's count, which
    // labelled established businesses "Micro Business").
    const { classifyBusinessTier, isEnterpriseBrand } = require('./competitorService');
    // Unknown lifetime count → unknown tier (not "Micro Business").
    const targetTier: string = lifetimeCount == null
      ? 'Unknown'
      : classifyBusinessTier(
          effectiveReviewCount,
          !!business.website,
          isEnterpriseBrand(business.name, effectiveReviewCount),
        );

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
      rating:         reviewFacts.lifetime.rating,
      reviewCount:    effectiveReviewCount,
      reviews:        formattedReviews,
    };

    // ── Website signals — derived from the one stored crawl (both depths) ─
    const depth: 'free' | 'full' = audit.fastMode ? 'free' : 'full';
    const websiteSignals: any = websiteIntel
      ? {
          reachable: websiteIntel.status !== 'failed',
          finalUrl: websiteIntel.pagesCrawled?.[0]?.url,
          servicePages: websiteServices,
          structureNote: websiteIntel.status === 'failed'
            ? 'Website is on the listing but did not respond to our check.'
            : `Website read (${(websiteIntel.pagesCrawled || []).filter((pg: any) => pg.status === 'ok').length} pages): ${websiteServices.length} services named${websiteIntel.bookingLinks?.length ? ', online booking link' : ''}${websiteIntel.socialProfiles?.length ? `, ${websiteIntel.socialProfiles.length} social profiles` : ''}.`,
        }
      : null;
    let gbpLive: any = null;
    if (depth === 'full' && business.googleLocationId) {
      try {
        const { fetchLocationProfile } = require('../../lib/gbpClient');
        const live = await fetchLocationProfile(audit.businessId.toString());
        gbpLive = {
          title: live?.title,
          description: live?.description,
          primaryPhone: live?.primaryPhone,
          website: live?.website,
          primaryCategory: live?.primaryCategory,
          additionalCategories: live?.additionalCategories || [],
        };
      } catch (gErr: any) {
        console.warn('[auditService] live GBP read failed:', gErr?.message);
      }
    }
    // ROI baseline — Google's own customer-action counts for the last 28
    // complete days (Performance API data lags ~3 days). Stored as measured
    // BEFORE → AFTER evidence; never projected into promised calls or leads.
    let performanceBaseline: any = null;
    if (depth === 'full' && business.googleLocationId) {
      try {
        const { fetchDailyMetrics } = require('../../lib/gbpClient');
        const end = new Date(Date.now() - 3 * 86_400_000);
        const start = new Date(end.getTime() - 27 * 86_400_000);
        const days: any[] = await fetchDailyMetrics(audit.businessId.toString(), start, end);
        const sum = (k: string) => days.reduce((a, d) => a + (Number(d[k]) || 0), 0);
        performanceBaseline = {
          status: 'verified',
          source: 'gbp_performance_api',
          periodStart: start.toISOString().slice(0, 10),
          periodEnd: end.toISOString().slice(0, 10),
          daysWithData: days.length,
          calls: sum('callClicks'),
          websiteClicks: sum('websiteClicks'),
          directionRequests: sum('directionRequests'),
          conversations: sum('conversations'),
          profileViews: sum('views'),
          collectedAt: new Date().toISOString(),
        };
      } catch (pErr: any) {
        performanceBaseline = { status: 'unavailable', source: 'gbp_performance_api', reason: String(pErr?.message || pErr).slice(0, 160) };
      }
    }

    // ── Native analytics ────────────────────────────────────────────────
    // Fields are checked against what we actually read from Google this run
    // (Places snapshot, and the live GBP profile for connected full audits)
    // — see calculateProfileCompletion.
    const profileCompletionPayload = calculateProfileCompletion(businessObj, { gbpLive, publicProfile });
    const profileCompletion = profileCompletionPayload.data;
    const reviewMetricsPayload = calculateReviewMetrics(
      formattedReviews,
      placesReviewCount && placesReviewCount > 0 && placesRating != null
        ? { rating: placesRating, reviewCount: placesReviewCount }
        : undefined,
      { periodDays: reviewPeriodDays },
    );
    const reviewMetrics = reviewMetricsPayload.data;

    const reviewQualityScore  = calculateReviewQualityScore(formattedReviews) as number;
    const reviewKeywordResult = analyzeReviewKeywords(formattedReviews, business);
    const keywordCoverageScore = (reviewKeywordResult.keywordScore || 0) as number;

    const nativeSeoScore  = calculateNativeSeoScore(businessObj, profileCompletion);
    const auditConfidence = calculateAuditConfidence(
      profileCompletion.completionPercentage,
      competitorFacts.length,
      formattedReviews.length,
      !!business.website,
      rankingFacts.overall.status,
    );
    const businessIntelligence = calculateBusinessIntelligence(
      business, competitorFacts, lifetimeCount, rankingFacts.overall, aheadFacts.count,
    );

    // Headline score = profile completion % (see the Aug 2026 note on why
    // nothing else is blended into it).
    const hasReviewData = formattedReviews.length > 0;
    const finalScore = profileCompletion.completionPercentage;

    // ── Findings + evidence ─────────────────────────────────────────────
    const fieldStates = profileFieldStates(profileCompletion.checklist || []);
    const titleName = String(business.name || '').trim();
    const selfPraiseTerm: string | undefined = findSelfPraiseTerm(titleName.toLowerCase());
    const titleWordCount = titleName.split(/\s+/).filter(Boolean).length;
    const suspensionRisk = suspensionRiskHeuristic({ selfPraiseTerm });
    const brandP = brandPhrase(business.name);
    keywordTable = keywordTable.map((k: any) => ({
      ...k,
      source: k.source || keywordSource(k.keyword, { websiteServices, ownerTerms, branded: false }),
      measured: k.measured ?? true,
    }));
    void brandP;
    const keywordRows: KeywordRow[] = keywordTable.map((k: any) => ({
      keyword: k.keyword,
      volumeBand: k.volumeBand,
      estimated: !!k.estimated,
      searchVolume: k.searchVolume ?? null,
      status: k.rankStatus === 'unavailable' ? 'unavailable' : 'ok',
      found: !!k.found,
      rank: k.rank ?? null,
    }));
    const descriptionReadable = fieldStates['Business Description'] && fieldStates['Business Description'] !== 'unknown';
    const { evidence, findings: builtFindings } = buildEvidenceAndFindings({
      fields: fieldStates,
      descriptionLength: descriptionReadable ? String(gbpLive?.description ?? business.description ?? '').length : null,
      title: { name: titleName, selfPraiseTerm: selfPraiseTerm || null, wordCount: titleWordCount },
      primaryKeyword: rankingFacts.primaryKeyword,
      primaryRanking: rankingFacts.primary,
      nearbyRanking: rankingFacts.nearby,
      nearbyByKeyword: rankingFacts.byKeyword.filter((k) => k.kind === 'nearby'),
      competitors: competitorFacts,
      competitorsAhead: aheadFacts,
      reviews: reviewFacts,
      reviewComparison,
      keywordRows,
      website: websiteSignals ? { onListing: !!business.website, reachable: !!websiteSignals.reachable } : null,
      suspensionRisk,
    });
    const findings = [...builtFindings];
    const nowIso = new Date().toISOString();
    if (websiteIntel && websiteIntel.status !== 'failed') {
      const claim = (id: string, metric: string, value: unknown, sourceUrl?: string) =>
        evidence.push({ id, metric, value, status: 'verified', source: 'website', state: 'SOURCE_CLAIM', sourceUrl, collectedAt: new Date(websiteIntel.fetchedAt || Date.now()).toISOString(), confidence: 'medium' });
      if (websiteServices.length) claim('website.services', 'website_services', websiteServices, websiteIntel.services[0]?.sourceUrl);
      if (websiteIntel.description?.value) claim('website.description', 'website_description', websiteIntel.description.value, websiteIntel.description.sourceUrl);
      if (websiteIntel.bookingLinks?.length) claim('website.booking', 'website_booking_link', websiteIntel.bookingLinks[0].value, websiteIntel.bookingLinks[0].sourceUrl);
      if (websiteIntel.serviceAreas?.length) claim('website.areas', 'website_service_areas', websiteIntel.serviceAreas.map((a: any) => a.value), websiteIntel.serviceAreas[0].sourceUrl);
      if (websiteIntel.credentials?.length) claim('website.credentials', 'website_credentials', websiteIntel.credentials.map((c: any) => c.value), websiteIntel.credentials[0].sourceUrl);
      // Website has a booking page; the public Google listing shows none.
      if (websiteIntel.bookingLinks?.length && publicProfile.observed && !publicProfile.bookingUrl) {
        findings.push({
          id: 'website.booking.not_on_listing',
          verificationOnly: true,
          category: 'website',
          title: 'Your website has a booking page; your Google listing did not show a booking link',
          evidence: `Website: ${websiteIntel.bookingLinks[0].value} · Google Maps results we read: no booking link shown`,
          evidenceIds: ['website.booking'],
          source: 'website',
          severity: 'low',
          confidence: 'medium',
          businessImpact: 'A booking link on the listing lets searchers book straight from Google Maps.',
          actionability: 'directly_fixable',
          growwmaticsCapability: null,
          recommendedAction: `Add ${websiteIntel.bookingLinks[0].value} as the appointment link in Google Business Profile.`,
        });
      }
      // The GBP service list is never read by any code path — so the website's
      // services become a verification step, never "your GBP is missing X".
      if (websiteServices.length && profileCompletion.checklist.find((c: any) => c.field === 'Services Listed')?.status !== 'Complete') {
        findings.push({
          id: 'website.services.verify_on_gbp',
          verificationOnly: true,
          category: 'website',
          title: `Check your Google profile lists the ${websiteServices.length} service${websiteServices.length === 1 ? '' : 's'} your website describes`,
          evidence: `Website (${websiteIntel.services[0]?.sourceUrl}): ${websiteServices.slice(0, 5).join(', ')}${websiteServices.length > 5 ? '…' : ''}`,
          evidenceIds: ['website.services'],
          source: 'website',
          severity: 'low',
          confidence: 'medium',
          businessImpact: 'Google matches listings to searches partly by the services listed on them; this report could not read your Google service list.',
          actionability: 'directly_fixable',
          growwmaticsCapability: null,
          recommendedAction: `Verify whether your Google Business Profile service list includes: ${websiteServices.slice(0, 5).join(', ')}.`,
        });
      }
    }
    if (rankingNotRunReason === 'category_unknown') {
      evidence.push({
        id: 'ranking.category_unknown',
        metric: 'search_category',
        value: resolvedCategory,
        status: 'unknown',
        source: 'google_places',
        confidence: 'high',
      });
      findings.push({
        id: 'data_quality.category_unknown',
        category: 'data_quality',
        title: 'Google Maps ranking not measured — business category unknown',
        evidence: `Google lists this business only under the generic category "${resolvedCategory}", so there is no customer search term to measure. Searching the business's own name would only measure brand lookups.`,
        evidenceIds: ['ranking.category_unknown'],
        source: 'google_places',
        severity: 'low',
        confidence: 'high',
        businessImpact: 'Ranking and competitors are unknown for this report — not a finding about the business.',
        actionability: 'directly_fixable',
        growwmaticsCapability: null,
        recommendedAction: 'Tell us your main service (and set a specific primary category in Google), then re-run the report.',
      });
    }
    const opportunities = selectOpportunities(keywordRows, 3);

    // ── Persist debug + sync metadata ────────────────────────────────────
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
      lifetimeReviewCount: lifetimeCount,
      recentReviewCount:  formattedReviews.length,
      reviewPeriodDays,
      reviewQualityScore,
      keywordCoverageScore,
      tier:               targetTier,
      rankingStatus:      rankingFacts.overall.status,
      searchesRun:        rankingFacts.overall.totalSearches,
      reviewKeywords:     reviewKeywordResult,
    };
    await audit.save();

    // ── AI analysis (interprets facts; cannot add them) ──────────────────
    // Compact facts the AI may cite. Numbers are pre-computed here.
    const aiFacts = {
      ranking: {
        overall: rankingFacts.overall,
        primaryKeyword: rankingFacts.primaryKeyword,
        primary: rankingFacts.primary,
        nearby: rankingFacts.nearby,
      },
      competitorsAhead: { count: aheadFacts.count, searchesChecked: aheadFacts.searchesChecked },
      topCompetitors: competitorFacts.slice(0, 8).map((c) => ({
        name: c.name, rating: c.rating, reviewCount: c.reviewCount, searchesAhead: c.searchesAhead, category: c.category,
      })),
      reviews: reviewFacts,
      reviewComparison,
      profileFields: fieldStates,
      suspensionRisk,
      keywordOpportunities: opportunities.map((o) => ({ keyword: o.keyword, demand: o.volumeBand, searchVolume: o.searchVolume, found: o.found, rank: o.rank })),
      // SOURCE_CLAIMs — what the business's website says (not verified).
      websiteClaims: websiteIntel && websiteIntel.status !== 'failed'
        ? {
            services: websiteServices.slice(0, 12),
            description: websiteIntel.description?.value ?? null,
            serviceAreas: (websiteIntel.serviceAreas || []).map((a: any) => a.value).slice(0, 8),
            credentials: (websiteIntel.credentials || []).map((c: any) => c.value).slice(0, 4),
            hasBookingLink: !!websiteIntel.bookingLinks?.length,
          }
        : websiteIntel ? 'website did not respond' : 'no website on listing',
      publicListing: publicProfile,
      competitorComparison,
    };
    const reviewTexts = reviewFacts.recent.textSampleCount > 0
      ? formattedReviews.filter((r) => (r.text || '').trim().length >= 20).map((r) => ({ rating: r.rating, text: r.text }))
      : [];

    // Narrative cache: inputsHash covers every fact the AI sees, so a real
    // change (new review, rank move, new finding) forces regeneration.
    const narrativeInputs = {
      aiFacts,
      findingIds: findings.map((f) => f.id).sort(),
      reviewTexts: reviewTexts.length,
      profileCompletionFact: profileCompletion.completionPromptFact || '',
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
    let ai: AuditAIResult;
    let aiFailure: string | null = null;
    if (narrativeCacheFresh) {
      meter('narrativeCacheHit', 1, 'ai_text_reused (30 days, same inputs)');
      ai = { ...(insightCache!.narrative!.aiFields as any), _usage: { promptTokens: 0, completionTokens: 0 } };
    } else {
      // A Groq failure (rate limit, outage) must not fail the report: the
      // deterministic facts and findings still ship, with no AI text at all.
      const { emptyAIResult } = require('../ai/auditEngine');
      ai = await generateAIAudit(
        {
          business: {
            name: business.name,
            category: resolvedCategory,
            location: [business.area, resolvedCity, business.state].filter(Boolean).join(', '),
            website: business.website || null,
            tier: targetTier,
          },
          facts: aiFacts,
          evidence,
          findings,
          reviewTexts,
          profileCompletionFact: profileCompletion.completionPromptFact || '',
          profileCompletionPending: Number(profileCompletion.oauthPendingCount ?? profileCompletion.unknownCount ?? 0),
          gbpRead: !!gbpLive,
          claimContext: {
            businessNames: [business.name, ...competitorFacts.map((c) => c.name)],
            places: [resolvedCity, business.area, business.state, business.country, ...areasChecked].filter(Boolean),
            serviceTerms: [
              ...collectVerifiedServices(business, { servicePages: websiteServices }),
              websiteIntel?.description?.value || '',
              ...(websiteIntel?.credentials || []).map((c: any) => c.value),
              resolvedCategory, websiteSearchTerm || '', publicProfile.category || '',
              ...(publicProfile.additionalCategories || []),
              ...keywordTable.map((k: any) => k.keyword),
            ].filter(Boolean),
          },
        },
        { actionPlanDurationDays },
      ).catch((aiErr: any) => {
        aiFailure = String(aiErr?.message || aiErr).slice(0, 200);
        console.warn('[auditService] AI analysis failed — continuing with verified facts only:', aiFailure);
        return emptyAIResult(actionPlanDurationDays);
      });
      if (!aiFailure) void logAIUsage({
        userId:      audit.userId,
        businessId:  audit.businessId?.toString(),
        promptType:  'audit_generation',
        aiModel:     GROQ_MODEL,
        promptTokens:     ai._usage?.promptTokens    ?? 0,
        completionTokens: ai._usage?.completionTokens ?? 0,
        status:      'success',
        durationMs:  Date.now() - auditStartMs,
      });
    }

    // ── Consultant SEO-plan sections ─────────────────────────────────────
    let seoPlanDraft: any = narrativeCacheFresh ? insightCache?.narrative?.aiFields?.seoPlanDraft : undefined;

    // ── Monthly cycle: what the AI may say changed (measured lines only) ──
    const lifecycleKind: string = (audit as any).auditKind || auditKindOf(audit);
    let monthlyContext: string[] = [];
    if (lifecycleKind === 'monthly') {
      try {
        const prevForAI: any = await Audit.findOne({ businessId: audit.businessId, status: 'COMPLETED', fastMode: { $ne: true }, _id: { $ne: audit._id }, 'auditData.facts.version': { $gte: 1 } })
          .sort({ createdAt: -1 })
          .select('createdAt fastMode metadata auditKind auditData.facts.ranking auditData.facts.reviews auditData.profileCompletion auditData.performanceBaseline')
          .lean();
        if (prevForAI) {
          const cmp = compareAudits(
            comparableSnapshot(prevForAI._id.toString(), auditKindOf(prevForAI), prevForAI.createdAt, prevForAI.auditData),
            comparableSnapshot(audit._id.toString(), 'monthly', new Date(), { facts: { ranking: rankingFacts, reviews: reviewFacts }, profileCompletion, performanceBaseline }),
          );
          monthlyContext = cmp.rows.filter((r) => r.change !== 'not_comparable').map((r) => `${r.metric}: ${r.before} → ${r.after} (${r.change})`);
          const ex = await collectExecutions(audit.businessId.toString(), new Date(prevForAI.createdAt), new Date());
          const gm = [ex.posts.length && `${ex.posts.length} Google posts published`, ex.replies.filter((r) => r.by !== 'external').length && `${ex.replies.filter((r) => r.by !== 'external').length} review replies posted`, ex.reviewRequests.sent && `${ex.reviewRequests.sent} review requests sent`].filter(Boolean);
          if (gm.length) monthlyContext.push(`Executed through GrowwMatics since the last audit: ${gm.join(', ')}`);
        }
      } catch (mcErr: any) {
        console.warn('[auditService] monthly context skipped:', mcErr?.message);
      }
    }
    // Built even without ranking data (e.g. category unknown) — its sections
    // then state what is missing instead of disappearing.
    if (!seoPlanDraft) {
      try {
        const { generateSeoPlanDraft } = require('../ai/seoPlanEngine');
        const verifiedServices = collectVerifiedServices(business, { servicePages: websiteServices });
        seoPlanDraft = await generateSeoPlanDraft({
          businessName: business.name,
          category: resolvedCategory,
          city: resolvedCity,
          area: business.area || '',
          state: business.state || '',
          country: business.country || '',
          website: business.website || '',
          neighbourhoods: areasChecked,
          primaryKeyword: rankingFacts.primaryKeyword || keywordTable[0]?.keyword || '',
          keywordTable,
          competitors: competitorFacts.slice(0, 10).map((c) => ({
            name: c.name,
            mapsRank: c.averageObservedRank,
            rating: c.rating,
            reviewCount: c.reviewCount,
            searchesAhead: c.searchesAhead,
            appearances: c.appearances,
            relevance: c.relevance,
            top3Count: c.top3Count,
            category: c.category,
            hasWebsite: !!c.website,
            hasBookingLink: !!c.bookingUrl,
            additionalCategories: c.additionalCategories,
            websiteServices: (c as any).websiteServices,
            source: c.source,
          })),
          searchesChecked: aheadFacts.searchesChecked,
          ranking: { overall: rankingFacts.overall, primary: rankingFacts.primary, notRunReason: rankingNotRunReason },
          reviews: { totalCount: lifetimeCount, rating: reviewFacts.lifetime.rating, sampleSize: reviewFacts.lifetime.sampleSize },
          reviewComparison,
          profileCompletion,
          fieldStates,
          findings: findings.filter(isVerifiedIssue),
          opportunities,
          strengths: ai.strengths,
          weaknesses: ai.weaknesses,
          depth,
          offers: business.offers || '',
          usps: business.intake?.uniqueSellingPoints || '',
          services: business.services || '',
          verifiedServices,
          ownerServices: collectVerifiedServices(business, null),
          websiteIntel,
          publicProfile,
          competitorComparison,
          websiteSearchTerm,
          monthlyContext,
          gbpRead: !!gbpLive,
          websiteSignals,
          gbpLive,
          suspensionRisk,
        });
      } catch (planErr: any) {
        console.warn('[auditService] seoPlanDraft generation failed:', planErr?.message);
      }
    }

    // ── Legacy fields (older UI/PDF code paths still read these) ─────────
    // Same shapes older readers expect, but not-found is null — never the
    // 21 placeholder (facts.ts is the source of truth).
    const legacyRankings = rankingFacts.byKeyword.map((k) => ({
      keyword: k.keyword,
      rank: k.averageObservedRank,
      found: k.foundCount > 0,
      status: k.status === 'unavailable' ? 'unavailable' : 'ok',
      sourceQuery: k.keyword,
      confidence: k.foundCount > 0 ? 'High' : 'Low',
    }));
    const googleSearchRank = {
      averageRank: rankingFacts.overall.averageObservedRank,
      topKeywords: rankingFacts.overall.testedCount > 0 ? legacyRankings : [],
    };
    // Map grid built from the SAME observations as every ranking statistic.
    const gridKeywords = gridFromObservations(observations);
    const primaryGridSummary = gridKeywords[0]?.summary;
    const geoGrid = gridKeywords.length && rankingFacts.overall.status !== 'unavailable'
      ? {
          keywords: gridKeywords.map(({ summary: _s, ...k }) => k),
          overallAvgRank: primaryGridSummary?.averageObservedRank ?? null,
          visibilityPct: primaryGridSummary?.visibilityRate != null ? Math.round(primaryGridSummary.visibilityRate * 100) : null,
          gridSpacingKm: gridMeta?.gridSpacingKm ?? 0,
          areaSqKm: gridMeta?.areaSqKm ?? 0,
          gridResolution: gridMeta?.gridResolution ?? (audit.fastMode ? 'reduced' : 'full'),
        }
      : null;

    const reviewAnalysis: any = (lifetimeCount != null || hasReviewData)
      ? {
          ...reviewMetrics,
          // Total + rating are LIFETIME values from Google — never the count
          // of the synced window.
          // null = unknown; the synced window is NEVER shown as the total.
          reviewCount: lifetimeCount,
          averageRating: reviewFacts.lifetime.rating,
          reviewsPerWeek: reviewFacts.recent.reviewsPerWeek,
          responseRate: reviewFacts.recent.responseRate != null ? `${Math.round(reviewFacts.recent.responseRate * 100)}%` : null,
          positivePercent: reviewFacts.recent.sentiment ? Math.round(reviewFacts.recent.sentiment.positive * 100) : null,
          neutralPercent: reviewFacts.recent.sentiment ? Math.round(reviewFacts.recent.sentiment.neutral * 100) : null,
          negativePercent: reviewFacts.recent.sentiment ? Math.round(reviewFacts.recent.sentiment.negative * 100) : null,
          recentPeriodDays: reviewPeriodDays,
          // The old 4.2/week "industry average" had no source — not shown.
          industryAverage: null,
          recentReviewCount: reviewFacts.recent.newReviewCount,
          mostCommonPraises: ai.reviewThemes !== 'unknown' ? ai.reviewThemes.praises : [],
          mostCommonComplaints: ai.reviewThemes !== 'unknown' ? ai.reviewThemes.complaints : [],
          reviewThemes: ai.reviewThemes === 'unknown' ? 'unknown' : 'from-review-text',
          ...(reviewFacts.recent.status === 'verified'
            ? {}
            : { estimatedFromPlaces: true, estimatedFields: ['reviewsPerWeek', 'responseRate', 'positivePercent', 'neutralPercent', 'negativePercent'] }),
        }
      : undefined;

    const keywordGapAnalysis = keywordRows
      .filter((k) => k.status === 'ok' && !k.estimated && !k.found && (k.volumeBand === 'HIGH' || k.volumeBand === 'MED'))
      .map((k) => ({ keyword: k.keyword, found: false, missing: true, priority: k.volumeBand === 'HIGH' ? 'High' : 'Medium' }));

    // ── Validation gate (before COMPLETED) ───────────────────────────────
    // Repairs are applied to `checked` and read back from it below.
    const checked: ValidatableAudit = {
      targetName: business.name,
      targetPlaceId: googlePlaceId || null,
      observations: marketObs,
      competitors: competitorFacts.filter((c) => c.source === 'dataforseo'),
      competitorsAheadCount: aheadFacts.count,
      averageObservedRank: rankingFacts.overall.averageObservedRank,
      reviews: reviewFacts,
      displayedReviewCount: reviewAnalysis?.reviewCount ?? null,
      displayedReviewsPerWeek: reviewAnalysis?.reviewsPerWeek ?? null,
      checklist: profileCompletion.checklist,
      completionPercentage: profileCompletion.completionPercentage,
      evidence,
      findings,
      reviewThemes: ai.reviewThemes,
      suspensionRisk,
      marketOpportunities: seoPlanDraft?.marketOpportunities,
      keywordRows,
    };
    const validation = validateAudit(checked);
    if (seoPlanDraft) seoPlanDraft.marketOpportunities = checked.marketOpportunities;
    if (reviewAnalysis && checked.reviewThemes === 'unknown') {
      reviewAnalysis.mostCommonPraises = [];
      reviewAnalysis.mostCommonComplaints = [];
      reviewAnalysis.reviewThemes = 'unknown';
    }
    const validFindings = checked.findings;
    // Competitors as repaired by validation (ranking-observed ones), plus any
    // Places fallback rows; the "ahead" count is re-derived from them.
    competitorFacts = [...checked.competitors, ...competitorFacts.filter((c) => c.source === 'google_places')];
    const aheadOut = { ...aheadFacts, count: checked.competitorsAheadCount, names: checked.competitors.map((c) => c.name) };
    const localPackCompetitors = competitorFacts.slice(0, 20).map((c) => ({
      name: c.name,
      avgRank: c.averageObservedRank ?? undefined,
      rating: c.rating ?? undefined,
      reviewCount: c.reviewCount ?? undefined,
      placeId: c.placeId ?? undefined,
    }));
    const validationRecord = {
      ok: validation.ok,
      errors: validation.errors,
      repairs: [...validation.repairs, ...(ai.groundingRepairs || [])],
      checkedAt: new Date().toISOString(),
    };
    if (!validation.ok) console.error(`[auditService] validation errors for audit ${auditId}:`, validation.errors);

    // Priority fixes = verified findings, ordered by the AI's judgement of
    // what matters for THIS business. Titles/evidence always come from code.
    const assessments = new Map((ai.findingAssessments || []).map((a) => [a.id, a]));
    // Verified problems only — verification steps live in the optimization plan.
    const customerFindings = validFindings.filter(isVerifiedIssue);
    const rankedFindings = [...customerFindings].sort((a, b) => {
      const pa = assessments.get(a.id)?.priority ?? 99;
      const pb = assessments.get(b.id)?.priority ?? 99;
      return pa - pb;
    });
    const priorityFixes = rankedFindings
      .filter((f) => assessments.get(f.id)?.matters !== false && f.actionability !== 'not_actionable' && f.actionability !== 'monitor_only')
      .map((f) => ({
        id: f.id,
        title: f.title,
        reason: repairUnverifiedGbpClaims(assessments.get(f.id)?.why, !!gbpLive) || f.businessImpact,
        evidence: f.evidence,
        impact: f.severity === 'high' ? 'High' : f.severity === 'medium' ? 'Medium' : 'Low',
        actionability: f.actionability,
        growwmaticsCapability: f.growwmaticsCapability,
        recommendedAction: repairUnverifiedGbpClaims(assessments.get(f.id)?.recommendedAction, !!gbpLive) || f.recommendedAction,
      }));

    const auditData: any = {
      profileScore: { overallScore: finalScore, seoScore: nativeSeoScore.score, profileCompletionScore: profileCompletion.completionPercentage },
      // Rating + sentiment quality of the synced review window — only
      // meaningful (and only read) when that window was actually synced.
      reviewQualityScore: reviewFacts.recent.status === 'verified' ? reviewQualityScore : null,
      googleSearchRank,
      keywordTable,
      areasChecked,
      ...(seoPlanDraft ? { seoPlanDraft } : {}),
      profileCompletion,
      seoScore: nativeSeoScore,
      auditConfidence,
      businessIntelligence,
      keywordGapAnalysis,
      ...(reviewAnalysis ? { reviewAnalysis } : {}),
      strengths: ai.strengths,
      weaknesses: ai.weaknesses,
      priorityFixes,
      thirtyDayPlan: ai.thirtyDayPlan,
      ninetyDayPlan: ai.ninetyDayPlan,
      actionPlan: ai.actionPlan,
      businessTier: targetTier,
      competitors: competitorFacts,
      localPackCompetitors,
      ...(geoGrid ? { geoGridRank: geoGrid } : {}),
      evidence: {
        competitors:       compEvidence,
        searchRankings:    rankingsEvidence,
        profileCompletion: profileCompletionPayload.evidenceSource,
        reviewAnalysis:    reviewMetricsPayload.evidenceSource,
        reviewKeywords:    reviewKeywordResult.evidenceSource,
      },
      dataQuality: {
        rankSource,
        reviewSource: reviewFacts.recent.status === 'verified' ? 'live-sync' : lifetimeInput ? 'places-snapshot' : 'unavailable',
        rankCacheHit: rankCacheFresh,
        narrativeCacheHit: narrativeCacheFresh,
      },
      // The traceable truth layer every customer-facing number reads from.
      facts: {
        version: 1,
        ranking: rankingFacts,
        observations,
        competitorsAhead: aheadOut,
        reviews: reviewFacts,
        reviewComparison,
        profileFields: fieldStates,
        suspensionRisk,
        keywordRows,
        publicProfile,
        competitorComparison,
        websiteSearchTerm,
        // Live GBP field values (connected audits) — the monthly report diffs
        // these between audits to find verified profile changes.
        gbpProfile: gbpLive ? { fields: gbpLive, readAt: new Date().toISOString() } : null,
        website: websiteIntel
          ? {
              origin: websiteIntel.origin,
              status: websiteIntel.status,
              fetchedAt: websiteIntel.fetchedAt,
              pagesCrawled: websiteIntel.pagesCrawled,
              services: websiteIntel.services,
              description: websiteIntel.description ?? null,
              serviceAreas: websiteIntel.serviceAreas,
              bookingLinks: websiteIntel.bookingLinks,
              socialProfiles: websiteIntel.socialProfiles,
              credentials: websiteIntel.credentials,
            }
          : null,
      },
      evidenceItems: evidence.map((e) => ({
        ...e,
        state: evidenceState(e),
        collectedAt: e.collectedAt || nowIso,
        businessId: audit.businessId?.toString(),
        auditId: audit._id?.toString(),
      })),
      // Each finding carries who executes it, whether Google must be
      // connected first, its evidence state and how it will be measured.
      findings: validFindings.map((f) => ({ ...f, ...findingExecution(f) })),
      validation: validationRecord,
    };

    // ── Audit kind, comparison with the previous audit, optimization plan ─
    const auditKind = (audit as any).auditKind || auditKindOf(audit);
    auditData.auditKind = auditKind;
    // Measured customer actions (connected audits). Free reports: not
    // available without a Google connection — stated, never estimated.
    auditData.performanceBaseline = performanceBaseline ?? {
      status: audit.fastMode ? 'not_measured' : 'unavailable',
      reason: audit.fastMode ? 'Calls, website clicks and direction requests need a Google connection.' : 'Google profile not connected.',
    };
    auditData.optimizationPlan = buildOptimizationPlan(validFindings.filter(isCustomerIssue) as any);
    if (!audit.fastMode) {
      try {
        const prev: any = await Audit.findOne({
          businessId: audit.businessId,
          status: 'COMPLETED',
          _id: { $ne: audit._id },
          'auditData.facts.version': { $gte: 1 },
          // A monthly report is compared with the previous connected audit
          // (baseline or last month), never with the public free report.
          ...(auditKind === 'monthly' ? { fastMode: { $ne: true } } : {}),
        })
          .sort({ createdAt: -1 })
          .select('fastMode metadata auditKind createdAt auditData.facts auditData.profileCompletion auditData.performanceBaseline auditData.findings')
          .lean();
        if (prev) {
          auditData.comparison = compareAudits(
            comparableSnapshot(prev._id.toString(), prev.auditKind || auditKindOf(prev), prev.createdAt, prev.auditData),
            comparableSnapshot(audit._id.toString(), auditKind, new Date(), auditData),
          );
        }
        // ── Lifecycle: baseline lineage, plan actions, monthly report ─────
        if (auditKind === 'connected_baseline' || auditKind === 'monthly') {
          const baseline: any = auditKind === 'connected_baseline'
            ? null
            : await Audit.findOne({ businessId: audit.businessId, auditKind: 'connected_baseline', status: 'COMPLETED' }).select('_id createdAt').lean();
          (audit as any).baselineAuditId = baseline?._id ?? undefined;
          (audit as any).previousAuditId = prev?._id ?? undefined;
          const periodStart = prev ? new Date(prev.createdAt) : null;
          auditData.lineage = {
            kind: auditKind,
            period: (audit as any).period ?? null,
            baselineAuditId: baseline?._id?.toString() ?? (auditKind === 'connected_baseline' ? audit._id.toString() : null),
            previousAuditId: prev?._id?.toString() ?? null,
            measurementPeriod: { start: periodStart?.toISOString() ?? null, end: new Date().toISOString() },
          };
          const actions = await syncOptimizationActions({
            businessId: audit.businessId.toString(),
            auditId: audit._id.toString(),
            auditAt: new Date(),
            plan: auditData.optimizationPlan,
            currentFindingIds: new Set(validFindings.map((f) => f.id)),
            gbpConnected: !!business.googleLocationId || !!gbpLive,
          }).catch((actErr: any) => {
            console.warn('[auditService] action sync failed:', actErr?.message);
            return [];
          });
          auditData.planActions = actions;
          if (auditKind === 'monthly' && prev && periodStart) {
            const executions = await collectExecutions(audit.businessId.toString(), periodStart, new Date());
            auditData.monthly = buildMonthlyReport({
              periodStart: periodStart.toISOString(),
              periodEnd: new Date().toISOString(),
              previousAuditId: prev._id.toString(),
              baselineAuditId: baseline?._id?.toString() ?? null,
              prevData: prev.auditData,
              curData: auditData,
              executions,
              actions,
            });
          }
        }
      } catch (cmpErr: any) {
        console.warn('[auditService] previous-audit comparison skipped:', cmpErr?.message);
      }
    }
    // Observed provider calls for this audit + list-price cost (free
    // allowances not applied — see costModel.ts). The Inngest review pre-sync
    // ran in its own step; its metered calls are merged in here.
    mergeIntoMeter(audit.metadata?.preSyncUsage?.counts, audit.metadata?.preSyncUsage?.reasons);
    const usage: Record<string, number> = { ...(currentMeter() || {}) } as any;
    const unitUsd = (k: string) => ((UNIT_PRICES as any)[k]?.usd ?? null) as number | null;
    let usageUsd = 0;
    for (const [k, n] of Object.entries(usage)) usageUsd += n * (unitUsd(k) ?? 0);
    const calls = providerCallLines(currentMeterReasons() || {}, unitUsd);
    const billableCalls = Object.entries(usage)
      // Paid provider calls only — cache hits, token counts and free website fetches excluded.
      .filter(([k]) => !/CacheHit$|Token$/.test(k) && k !== 'websiteFetch')
      .reduce((a, [, n]) => a + n, 0);
    auditData.providerUsage = {
      counts: usage,
      calls,
      billableCalls,
      listPriceUsd: Math.round(usageUsd * 10_000) / 10_000,
      measuredAt: new Date().toISOString(),
      note: 'List prices, before provider free allowances. Intake Places lookups happen before the audit and are not included.',
      // PAID CALL → RESULT USED? The first place to look for waste.
      resultUse: [
        { call: 'dataForSeoMapsLiveTask', paid: usage.dataForSeoMapsLiveTask || 0, used: rankingFacts.overall.testedCount > 0,
          detail: `${rankingFacts.overall.testedCount} valid, ${rankingFacts.overall.unavailableCount} unavailable (timeouts/failures may still be billed)` },
        { call: 'dataForSeoAdsVolumeLiveTask', paid: usage.dataForSeoAdsVolumeLiveTask || 0, used: keywordTable.some((k: any) => k.searchVolume != null),
          detail: `${keywordTable.filter((k: any) => k.searchVolume != null).length} of ${keywordTable.length} keywords returned volume` },
        { call: 'googleGeocoding', paid: usage.googleGeocoding || 0, used: areasChecked.length > 0, detail: `${areasChecked.length} nearby areas named` },
        { call: 'googleTextSearch', paid: usage.googleTextSearch || 0, used: competitorFacts.some((c) => c.source === 'google_places'),
          detail: 'competitor fallback only when ranking produced no competitors' },
        { call: 'serpApiSearch', paid: usage.serpApiSearch || 0, used: reviewFacts.recent.status === 'verified', detail: 'review sync for the recent-activity window' },
        { call: 'groqCall', paid: usage.groqCall || 0, used: !aiFailure, detail: aiFailure ? 'AI failed — deterministic report only' : 'narrative + consultant sections' },
      ].filter((r) => r.paid > 0),
    };

    // ── AI status + data-quality record (for debugging a customer report) ─
    const consultantFailed: string[] = seoPlanDraft?.failed || [];
    auditData.aiStatus = {
      analysis: narrativeCacheFresh ? 'cached' : aiFailure ? 'failed' : 'ok',
      analysisError: aiFailure,
      consultant: !seoPlanDraft ? 'failed' : consultantFailed.length ? 'partial' : 'ok',
      consultantFailed,
      validationRepairs: validationRecord.repairs.length + (seoPlanDraft?.repairs?.length || 0),
    };
    const stateCounts: Record<string, number> = {};
    for (const e of auditData.evidenceItems) stateCounts[e.state] = (stateCounts[e.state] || 0) + 1;
    auditData.dataQuality = {
      ...auditData.dataQuality,
      auditType: auditKind,
      sources: [
        // Places data is read at intake (before the audit), so its time is the business record's.
        { source: 'google_places', status: lifetimeInput?.source === 'google_places' || business.placesReviewCount != null ? 'ok' : 'not_used', at: (businessObj as any).updatedAt ?? null },
        { source: 'dataforseo_maps', status: rankingFacts.overall.status, at: nowIso },
        { source: 'dataforseo_ads_volume', status: keywordTable.some((k: any) => k.demandStatus === 'measured') ? 'ok' : keywordTable.length ? 'no_volume_returned' : 'not_run', at: nowIso },
        { source: 'reviews', status: reviewFacts.recent.status === 'verified' ? 'synced' : 'lifetime_only', at: totals?.capturedAt ?? null, provider: reviewFacts.lifetime.source },
        { source: 'website', status: !business.website ? 'no_website' : websiteIntel?.status ?? 'not_read', at: websiteIntel?.fetchedAt ?? null },
        { source: 'gbp_api', status: gbpLive ? 'read' : business.googleLocationId && !audit.fastMode ? 'read_failed' : 'not_connected', at: gbpLive ? nowIso : null },
      ],
      ranking: {
        searches: rankingFacts.overall.totalSearches,
        found: rankingFacts.overall.foundCount,
        notFound: rankingFacts.overall.notFoundCount,
        unavailable: rankingFacts.overall.unavailableCount,
        notRunReason: rankingNotRunReason,
      },
      competitorCount: competitorFacts.length,
      competitorsByRelevance: competitorFacts.reduce((m: Record<string, number>, c) => ({ ...m, [c.relevance]: (m[c.relevance] || 0) + 1 }), {}),
      websiteCrawl: websiteIntel ? { status: websiteIntel.status, pages: (websiteIntel.pagesCrawled || []).length, cacheHit: !!(currentMeter()?.websiteIntelCacheHit) } : null,
      ai: auditData.aiStatus,
      validation: { ok: validation.ok, errors: validation.errors.length, repairs: validationRecord.repairs.length },
      evidenceStates: stateCounts,
      apiCalls: billableCalls,
      estimatedCostUsd: auditData.providerUsage.listPriceUsd,
      cache: { rank: rankCacheFresh, narrative: narrativeCacheFresh },
    };

    audit.auditVersion = 'V7';
    audit.overallScore = finalScore;
    audit.auditData    = auditData;
    // Validation gate: a report with unrepairable problems never reaches the
    // customer — it is stored (for support) but marked FAILED, and the
    // free-report page offers a retry.
    audit.status       = validation.ok ? 'COMPLETED' : 'FAILED';
    if (!validation.ok) releasePeriod(audit);
    if (!validation.ok) {
      audit.metadata = { ...(audit.metadata || {}), error: 'Report validation failed', validationErrors: validation.errors };
    }

    // Never cache a narrative produced while the AI was failing.
    if (cacheable && wonNarrativeClaim && validation.ok && !aiFailure && !(seoPlanDraft?.failed || []).length) {
      await PlaceInsightCache.updateOne(
        { googlePlaceId },
        {
          $set: {
            narrative: {
              inputsHash,
              aiFields: {
                findingAssessments: ai.findingAssessments,
                strengths:     ai.strengths,
                weaknesses:    ai.weaknesses,
                reviewThemes:  ai.reviewThemes,
                thirtyDayPlan: ai.thirtyDayPlan,
                ninetyDayPlan: ai.ninetyDayPlan,
                actionPlan:    ai.actionPlan,
                groundingRepairs: ai.groundingRepairs,
                seoPlanDraft,
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

    await audit.save();
    console.log(`[auditService] V7 audit completed: ${auditId} | score=${finalScore} | lifetimeReviews=${lifetimeCount ?? 'unknown'} | searches=${rankingFacts.overall.testedCount}/${rankingFacts.overall.totalSearches} | validation=${validation.ok ? 'ok' : 'errors'}`);

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

      // ── Upsert the SEO brain ──────────────────────────────────────────────
      // Every completed audit — free reports included — creates the next
      // SeoPlan version and supersedes the prior active one. Content jobs and
      // review replies read getActiveSeoPlan() from here on. Best-effort: a
      // failure must not fail the audit itself.
      try {
        const { upsertSeoPlanFromAudit } = require('../seoPlan/seoPlanService');
        await upsertSeoPlanFromAudit({
          businessId: audit.businessId.toString(),
          sourceAuditId: audit._id.toString(),
          draft: seoPlanDraft,
          keywordTable,
          areasChecked,
          baseline: {
            overallScore: finalScore,
            // undefined = not measured / never found — never a stand-in 0.
            avgRank: rankingFacts.overall.averageObservedRank ?? undefined,
            reviewCount: lifetimeCount ?? undefined,
            rating: reviewFacts.lifetime.rating ?? undefined,
            completionPct: profileCompletion.completionPercentage,
          },
        });
      } catch (planErr: any) {
        console.error(`[auditService] SeoPlan upsert failed for business ${audit.businessId}:`, planErr?.message);
      }

      // Monthly report ready → in-app + (opted-in) WhatsApp, built only from
      // the report's own measured values.
      if (auditKind === 'monthly') {
        try {
          const { notifyMonthlyReport } = require('../lifecycle/notify');
          await notifyMonthlyReport(audit.businessId.toString(), audit._id.toString(), auditData);
        } catch (nErr: any) {
          console.warn('[auditService] monthly notification failed:', nErr?.message);
        }
      }
    }

  } catch (error) {
    console.error(`[auditService] Failed audit ${auditId}:`, error);
    audit.status = 'FAILED';
    if (error instanceof Error) audit.metadata = { ...(audit.metadata || {}), error: error.message };
    releasePeriod(audit);
    await audit.save();
    throw error;
  }
}

/**
 * Services the report may name as the business's own: live-listed, owner
 * provided, or seen as a service link on the business's own website. Never
 * generated.
 */
function collectVerifiedServices(business: any, websiteSignals: any): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const v = String(s || '').trim();
    if (v.length >= 3 && v.length <= 60 && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  String(business.services || '').split(/[,;\n]+/).forEach(push);
  // NOT business.keywords: those are auto-filled from earlier audits'
  // keyword phrases ("it training institute kolkata"), not services.
  (websiteSignals?.servicePages || []).forEach(push);
  return out.slice(0, 20);
}

/** The like-for-like numbers two audits can be compared on. */
function comparableSnapshot(auditId: string, kind: ComparableSnapshot['kind'], at: Date | string, data: any): ComparableSnapshot {
  const overall = data?.facts?.ranking?.overall || {};
  const byKeyword: any[] = data?.facts?.ranking?.byKeyword || [];
  const lifetime = data?.facts?.reviews?.lifetime || {};
  return {
    auditId,
    kind,
    at: new Date(at).toISOString(),
    keywords: byKeyword.filter((k) => k.kind !== 'brand').map((k) => String(k.keyword)),
    searches: Number(overall.testedCount) || 0,
    foundCount: Number(overall.foundCount) || 0,
    top3Count: Number(overall.top3Count) || 0,
    averageObservedRank: overall.averageObservedRank ?? null,
    reviewCount: lifetime.totalCount ?? null,
    rating: lifetime.rating ?? null,
    completionPercentage: data?.profileCompletion?.completionPercentage ?? null,
    completionScope: data?.profileCompletion?.completionScope ?? null,
    performance: data?.performanceBaseline?.status === 'verified'
      ? {
          days: 28,
          calls: data.performanceBaseline.calls,
          websiteClicks: data.performanceBaseline.websiteClicks,
          directionRequests: data.performanceBaseline.directionRequests,
        }
      : null,
  };
}

/** A failed baseline / monthly audit gives its idempotency slot back so it can be retried. */
function releasePeriod(audit: any) {
  if (audit?.period) {
    audit.failedPeriod = audit.period;
    audit.period = undefined;
  }
}
