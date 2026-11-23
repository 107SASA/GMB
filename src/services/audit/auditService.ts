import crypto from 'crypto';
import dbConnect from '../../lib/mongodb';
import Audit from '../../models/Audit';
import Business from '../../models/Business';
import Review from '../../models/Review';
import PlaceInsightCache, { claimInsightRefresh, waitForInsightRefresh, IPlaceInsightCache } from '../../models/PlaceInsightCache';
import { generateAIAudit, type AuditAIResult } from '../ai/auditEngine';
import { REPORT_LOGIC_VERSION } from './reportLogicVersion';
import {
  buildReviewFacts,
  compareReviews,
  competitorsAhead,
  AROUND_ADDRESS,
  competitorsFromObservations,
  competitorKey,
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
import { areaStrategyLines, type AreaComparison, type AreaVisibilityFacts } from './areaVisibility';
import { validateAudit, repairUnverifiedGbpClaims, allReviewsReplied, type ValidatableAudit } from './validateAudit';
import { getWebsiteIntelligence } from '../intel/websiteIntelligence';
import { assembleFr4 } from './fr4/assemble';
import { postsInLast30Days } from './fr4/benchmark';
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
// v12 (Nov 2026): weak category + trade in the name ("Durva Fireworks" /
// "Store") searched as "Fireworks Store"; only same-trade businesses count as
// competitors; stored keywords used only after intake.
// v13 (Nov 2026): competitors from the Google category — category searched
// for competitors, same Google category required, Places fallback filtered.
// v14 (Nov 2026): trade fallback chain (place types → description → name →
// website); no trade known → no competitors shown in the free report.
// v15 (Nov 2026): business-type categories ("Manufacturer", "Food products
// supplier", "Wholesaler") are not a trade — the product from the name is
// ("Shree Cashew Industries" → "cashew manufacturer"); keyword logic back to
// the Google category (the Nov 16 website-services keywords were reverted);
// the category comes from the business's own Google listing (S0) before the
// type saved at sign-up.
// v16 (Nov 2026): city phrases are checked first and at most one "near me"
// (a yoga studio got 6 "near me" checks, all #1); the city people type
// ("Mohali", not "Sahibzada Ajit Singh Nagar"); a free report searches the
// areas the website says it serves from inside each area.
// v17 (Nov 2026): keyword shortlist (docs/FREE_REPORT_REBUILD_PLAN.md Part C)
// — every possible keyword (services × city / areas, Google Ads ideas) →
// volume for all → ~10 shortlisted → only those rank-checked; website-vs-
// Google service gap, competitor category gap, competitor keyword gap;
// service-area businesses also searched from the city centre; the shortlist
// is saved for the first connected audit (before / after).
// v18 (Nov 2026): every shortlisted keyword keeps what the business sells —
// a Google idea must keep a service's main word ("goldsmith near me" is not
// "goldsmith supplies"); same-offer services ("jewellery tools" / "… shop" /
// "Jewelry …") are one group, each group checked once before second shapes;
// with no Google numbers, the Google category's offer first and a service
// named once, connected to nothing, last.
const CACHE_LOGIC_VERSION = REPORT_LOGIC_VERSION;

/** How recently a review sync must have refreshed Google's totals for the
 *  analysis window to count as synced (the Inngest pre-sync runs minutes
 *  before this job). */
const RECENT_SYNC_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Values that are not a business category at all. */
const PLACEHOLDER_CATEGORY = /^(local business|business|establishment|point of interest|manufacturer|supplier|wholesaler|exporter|services?|company|store|shop)$/i;

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
    // The city customers type: the saved city, else (free report) Google's
    // own city for the pin, else the address text; official names — which
    // Google itself uses for some pins ("Sahibzada Ajit Singh Nagar") — are
    // mapped to the common one ("Mohali", searchCityName). The nearby lookup
    // is cached and reused by the keyword step below.
    let earlyLocalities: { neighbourhoods: string[]; resolvedCity: string | null } | null = null;
    if (audit.fastMode && business.coordinates?.lat && business.coordinates?.lng) {
      try {
        earlyLocalities = await require('./localities').fetchNearbyLocalities(business.coordinates, { limit: 8 });
      } catch { /* address city below */ }
    }
    const resolvedCity: string = require('./businessUnderstanding').searchCityName(
      audit.city || business.city || earlyLocalities?.resolvedCity || (() => {
        if (!business.address) return '';
        const parts = business.address.split(',').map((p: string) => p.trim()).filter(Boolean);
        return parts.length >= 3 ? (parts[parts.length - 3] || '') : (parts[parts.length - 1] || '');
      })(),
    );
    // ── S0: the business's real Google listing (docs/FREE_REPORT_REBUILD_PLAN.md) ─
    // The sign-up form saves Google Places' rough type ("Services",
    // "Manufacturer", "Medical Clinic"); the listing shows the category the
    // owner chose ("Mental health service"). Read it first — one Maps search,
    // matched by Place ID only, saved on the business for 30 days.
    const { getOwnListing, ownListingCategory, ownListingAsPublicProfile } = require('./ownListing');
    // The website read does not depend on the listing — start it now and run
    // both at once (speed: the two used to run one after the other).
    const websiteIntelPromise: Promise<any> = business.website
      ? getWebsiteIntelligence(business.website, { maxPages: 6 }).catch((wiErr: any) => {
          console.warn('[auditService] website intelligence failed:', wiErr?.message);
          return null;
        })
      : Promise.resolve(null);
    const stageStart = Date.now();
    const own = await getOwnListing(business, { city: resolvedCity });
    const timings: Record<string, number> = { ownListingMs: Date.now() - stageStart };
    const ownListing: import('./ownListing').OwnListing | null = own.listing;
    if (own.fetched && ownListing) {
      await Business.updateOne({ _id: business._id }, { $set: { googleListing: ownListing } })
        .catch((e: any) => console.warn('[auditService] could not save googleListing:', e?.message));
    }
    // Order: the owner's own choice (intake / settings) → the real Google
    // listing → the type saved at sign-up → Google place types → "Local Business".
    const storedCategory: string = audit.userDefinedCategory || business.category || '';
    const typeCategory: string = (() => {
      try { return require('../google/places').deriveCategory(Array.isArray(business.googleTypes) ? business.googleTypes : []) || ''; } catch { return ''; }
    })();
    const categoryChoice: { category: string; source: string } = ownListingCategory({
      listing: ownListing,
      ownerConfirmed: business.userDefinedCategory || null,
      stored: storedCategory || null,
      fromPlaceTypes: typeCategory || null,
    });
    const resolvedCategory: string = categoryChoice.category;
    if (categoryChoice.source === 'google_listing' && storedCategory && storedCategory !== resolvedCategory) {
      console.log(`[auditService] category from the Google listing: "${resolvedCategory}" (sign-up saved "${storedCategory}")`);
    }

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
    // Started above, alongside the listing lookup.
    const websiteStart = Date.now();
    const websiteIntel: any = await websiteIntelPromise;
    timings.websiteWaitMs = Date.now() - websiteStart;
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

    // ── S1: what the business does (free report; docs/FREE_REPORT_REBUILD_PLAN.md) ─
    // The AI reads the Google listing first, the website only when there is
    // one; every answer is checked against that evidence and saved on the
    // business (same inputs → same answer). Low confidence or no answer →
    // the category rules below, as before.
    let understanding: import('./businessUnderstanding').Understanding | null = null;
    // Stems of the business's own words — keyword ideas must be grounded in them.
    let understandingEvidence: Set<string> | null = null;
    let understandingError: string | null = null;
    let understandingReused = false;
    if (audit.fastMode) {
      const { understandBusiness } = require('./businessUnderstanding');
      const input: import('./businessUnderstanding').UnderstandingInput = {
        name: business.name || '',
        city: resolvedCity,
        area: business.area || '',
        primaryCategory: resolvedCategory,
        additionalCategories: ownListing?.additionalCategories || [],
        placeTypes: Array.isArray(business.googleTypes) ? business.googleTypes : [],
        googleDescription: ownListing?.snippet ?? null,
        ownerDescription: business.description || null,
        // Only a found listing can say the address is hidden.
        addressShown: ownListing ? !!ownListing.address : null,
        websiteTitle: websiteIntel && websiteIntel.status !== 'failed' ? websiteIntel.title ?? null : null,
        websiteDescription: websiteIntel && websiteIntel.status !== 'failed' ? websiteIntel.description?.value ?? null : null,
        websiteServices,
      };
      understandingEvidence = require('./businessUnderstanding').evidenceStems(input);
      // The website's page text too ("power yoga" in a class schedule, not only the services list).
      require('./businessUnderstanding').addEvidenceText(understandingEvidence, String(websiteIntel?.fr4Signals?.textSample || ''));
      const uStart = Date.now();
      const u = await understandBusiness(input, { saved: (business as any).businessUnderstanding ?? null });
      timings.understandingMs = Date.now() - uStart;
      understandingError = u.error;
      understandingReused = u.reused;
      if (u.understanding && !u.reused) {
        await Business.updateOne({ _id: business._id }, { $set: { businessUnderstanding: u.understanding } })
          .catch((e: any) => console.warn('[auditService] could not save businessUnderstanding:', e?.message));
      }
      if (u.understanding && u.understanding.confidence !== 'low') understanding = u.understanding;
      if (u.error) console.warn('[auditService] business understanding unavailable — category rules used:', u.error);
    }

    const businessForRankings = {
      ...businessObj,
      name: businessObj.name || business.name,
      // Owner keywords only once the owner has confirmed them (intake), like
      // ownerTerms above — a stored list can be leftovers ("Store near me",
      // bare area names) that searched for every kind of shop.
      keywords: business.intakeCompleted && Array.isArray(businessObj.keywords) ? businessObj.keywords : [],
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

    // ── Keyword shortlist (docs/FREE_REPORT_REBUILD_PLAN.md Part C) ─────
    // Every possible keyword (services × city / areas, Google Ads ideas,
    // "near me") → one volume lookup for all → a shortlist of ~10 → only the
    // shortlist is rank-checked. Same building blocks as the connected audit.
    // Only when the ranking is not reused from the 7-day cache.
    let understoodPick: {
      picked: import('./understoodKeywords').PickedKeyword[];
      mainTerm: string | null;
      areas: string[];
      shortlist: import('../seo/keywordTypes').ScoredKeyword[];
      research: { candidates: number; withVolume: number; ideas: number; ideasUsed: number; cityVolume: boolean };
    } | null = null;
    let nearbyLocalities: { neighbourhoods: string[] } | null = null;
    if (!cachedRank && audit.fastMode && understanding && understandingEvidence) {
      const kStart = Date.now();
      try {
        const { fetchNearbyLocalities } = require('./localities');
        const { cleanAreas } = require('./understoodKeywords');
        const { websiteServiceAreaPlaces } = require('./areaDiscovery');
        const { freeReportServices, freeReportCandidates, pickShortlist, FREE_SHORTLIST_LIMITS } = require('./freeReportShortlist');
        const { fetchSearchVolumes } = require('./keywordVolumeClient');
        const { fetchKeywordIdeas } = require('./keywordIdeasClient');
        const { cityAdsLocationCode } = require('./areaDemand');
        const { volumeOf } = require('../seo/keywordMeasure');
        const { scoreCandidates } = require('../seo/keywordSet');

        nearbyLocalities = earlyLocalities ?? await fetchNearbyLocalities(businessForRankings.coordinates, { limit: 8 });
        // Areas served (the website's list) first, then clean nearby localities.
        const servedAreas: string[] = websiteIntel?.serviceAreas?.length
          ? websiteServiceAreaPlaces(websiteIntel.serviceAreas.map((a: any) => String(a?.value || '')), resolvedCity).map((a: any) => String(a.placeName))
          : [];
        const areas: string[] = Array.from(new Set([...servedAreas, ...cleanAreas(nearbyLocalities?.neighbourhoods || [], resolvedCity)]));
        const services = freeReportServices({
          aiTerms: understanding.searchTerms,
          categories: [resolvedCategory, ...(ownListing?.additionalCategories || [])],
          websiteServices,
          offered: understanding.offered,
        });
        const place = { city: resolvedCity, area: business.area, state: business.state, country: business.country };
        const country = business.country || '';
        // Paid extras, each switchable off: Google Ads ideas, city-level volume.
        const ideasOn = process.env.FREE_REPORT_KEYWORD_IDEAS !== 'off';
        const cityVolOn = process.env.FREE_REPORT_CITY_VOLUME !== 'off';
        const cityCode: number | null = cityVolOn || ideasOn ? await cityAdsLocationCode(place) : null;
        const ideas: Array<{ keyword: string; volume: number | null }> = ideasOn
          ? await fetchKeywordIdeas(services.slice(0, FREE_SHORTLIST_LIMITS.ideaSeeds).map((x: any) => x.name), { locationCode: cityCode, countryHint: country }).catch(() => [])
          : [];
        const candidates = freeReportCandidates({
          businessName: business.name || '',
          city: resolvedCity,
          areas,
          services,
          ideas,
          evidence: understandingEvidence,
          servedHow: understanding.servedHow,
        });
        const phrases = candidates.map((c: any) => c.keyword);
        const [countryVol, cityVol] = await Promise.all([
          fetchSearchVolumes(phrases, { countryHint: country }).catch(() => new Map()),
          cityVolOn && cityCode ? fetchSearchVolumes(phrases, { locationCode: cityCode }).catch(() => new Map()) : Promise.resolve(new Map()),
        ]);
        const measuredAt = new Date().toISOString();
        const volumes = new Map(candidates.map((c: any) => [c.id, volumeOf(c.keyword, {
          country: countryVol, city: cityVol,
          ideaVolume: c.sources.includes('google_ideas') ? c.ideaVolume : undefined,
        }, measuredAt)]));
        const scored = scoreCandidates({ candidates, volumes, ranks: new Map(), competitors: new Map(), ourReviews: null });
        const shortlist = pickShortlist(scored, { city: resolvedCity, areas, servedHow: understanding.servedHow, categories: [resolvedCategory, ...(ownListing?.additionalCategories || [])] });
        if (shortlist.length) {
          const city = resolvedCity.toLowerCase();
          const shapeOf = (k: string): 'city' | 'near_me' | 'area' => (/\bnear me\b/.test(k) ? 'near_me' : city && k.includes(city) ? 'city' : 'area');
          understoodPick = {
            picked: shortlist.map((k: any) => ({
              keyword: k.keyword,
              term: k.service || k.keyword,
              shape: shapeOf(k.keyword),
              volume: k.volume.city ?? k.volume.country ?? null,
            })),
            // The service behind the first (main) phrase: area searches and
            // competitor searches use it ("yoga classes" → "yoga classes chandigarh").
            mainTerm: shortlist[0].service || understanding.searchTerms[0] || null,
            areas,
            shortlist,
            research: {
              candidates: candidates.length,
              withVolume: Array.from(volumes.values()).filter((v: any) => v.status === 'measured').length,
              ideas: ideas.length,
              ideasUsed: candidates.filter((c: any) => c.sources.includes('google_ideas')).length,
              cityVolume: !!(cityVolOn && cityCode),
            },
          };
          // The grid's main phrase: the first shortlist keyword ("yoga classes mohali").
          (businessForRankings as any).keywords = [shortlist[0].keyword];
        }
      } catch (kwErr: any) {
        console.warn('[auditService] keyword shortlist failed — category keywords used:', kwErr?.message);
      }
      timings.keywordVolumeMs = Date.now() - kStart;
    }

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

        const localities = nearbyLocalities ?? await fetchNearbyLocalities(businessForRankings.coordinates, { limit: 8 });
        // Understood business → the picked phrases (S2/S3). Otherwise the
        // category seeds as before, plus up to 3 website services city-wide.
        const seeded = understoodPick
          ? { keywords: understoodPick.picked.map((k) => k.keyword), primaryKeyword: understoodPick.picked[0]?.keyword || '', areasUsed: understoodPick.areas }
          : buildFreeReportKeywords(
              { ...businessForRankings, city: resolvedCity, category: websiteSearchPhrase || resolvedCategory },
              localities.neighbourhoods,
            );
        if (!understoodPick) {
          for (const kw of websiteServiceKeywords(websiteServices, resolvedCity, 3)) {
            if (!seeded.keywords.some((k: string) => k.toLowerCase() === kw)) seeded.keywords.push(kw);
          }
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

    // ── Competitor searches from the Google category (free report) ─────
    // Competitors are local businesses in the same Google category. The
    // keyword searches above follow the website's services, so the category
    // itself is searched too ("dentist nashik", "dentist near me") — for
    // competitors only: these never enter the ranking table or statistics.
    const { specificWords } = require('./competitorRelevance');
    // The phrase must name a trade: "Manufacturer" alone is not searched, the
    // name's product is ("Shree Cashew Industries" → "cashew manufacturer").
    // An understood business searches its most-searched term (S1–S3).
    const tradeSearchPhrase: string = understoodPick?.mainTerm
      || (categorySearchable ? resolveCat(resolvedCategory, business.name, [resolvedCity, business.area, business.state]) || '' : '');
    const googleTradeCategory: string | null = specificWords(tradeSearchPhrase).length > 0 ? tradeSearchPhrase : null;
    let competitorSearchObs: SearchObservation[] = cachedRank ? (cachedRank.competitorObservations || []) : [];
    if (!cachedRank && audit.fastMode && googleTradeCategory && rankData && !rankData.fetchError) {
      try {
        const { fetchKeywordRankSnapshot } = require('./seoAnalyzer');
        const phrase = toSearchPhrase(googleTradeCategory);
        const city = String(resolvedCity || '').trim().toLowerCase();
        const already = new Set(observations.map((o) => o.keyword.toLowerCase()));
        const wanted = [city ? `${phrase} ${city}` : null, `${phrase} near me`]
          .filter((k): k is string => !!k && !!phrase && !already.has(k));
        const snapshot = await fetchKeywordRankSnapshot(businessForRankings, wanted, { kindOf: () => 'discovery' });
        competitorSearchObs = snapshot.map((r: any) => r.observation);
      } catch (csErr: any) {
        console.warn('[auditService] competitor category search failed:', csErr?.message);
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
    // Save the free report's shortlist + ranks on the business: the first
    // connected audit re-checks the same keywords (before / after).
    if (understoodPick && audit.fastMode) {
      const rankOf = new Map(rankingFacts.byKeyword.map((k) => [k.keyword.toLowerCase(), k]));
      const saved = {
        auditId: String(audit._id),
        at: new Date().toISOString(),
        city: resolvedCity,
        keywords: understoodPick.shortlist.map((k) => {
          const r: any = rankOf.get(k.keyword.toLowerCase());
          const measured = !!r && r.status !== 'unavailable' && (r.testedCount ?? 0) > 0;
          return {
            keyword: k.keyword,
            service: k.service,
            volume: k.volume.city ?? k.volume.country ?? null,
            rank: measured && r.foundCount > 0 ? r.averageObservedRank : null,
            measured,
          };
        }),
      };
      await Business.updateOne({ _id: business._id }, { $set: { freeReportKeywords: saved } })
        .catch((e: any) => console.warn('[auditService] could not save freeReportKeywords:', e?.message));
    }
    const rankSource: 'full-grid' | 'reduced-grid' | 'unavailable' | 'error' =
      rankingFacts.overall.status === 'not_run'
        ? 'unavailable'
        : rankingFacts.overall.status === 'unavailable'
          ? 'error'
          : gridMeta?.gridResolution === 'reduced' ? 'reduced-grid' : 'full-grid';
    // ── Where competitors are looked for, and which of them are in the trade ─
    // Two separate steps: areaDiscovery.ts decides WHERE to search (the ranking
    // grid around the business, then the GBP service areas, then wider rings
    // while too few relevant competitors are found); competitorRelevance.ts
    // decides WHETHER a business found there is a competitor.
    const { buildTradeProfile, classifyCompetitor } = require('./competitorRelevance');
    let gbpCategories: string[] = [];
    let gbpServiceAreas: Array<{ placeName: string | null; placeId: string | null }> = [];
    // Services listed on the Google profile; null = the profile was not read.
    let gbpListedServices: string[] | null = null;
    let gbpDescription: string | null = null;
    try {
      const GbpLocationSnapshot = require('../../models/GbpLocationSnapshot').default;
      const snap: any = await GbpLocationSnapshot.findOne({ businessId: business._id }).select('sections.location').lean();
      const loc = snap?.sections?.location?.meta?.status === 'SUCCESS' ? snap.sections.location.data : null;
      gbpCategories = [loc?.primaryCategory?.displayName, ...(loc?.additionalCategories || []).map((c: any) => c?.displayName)].filter(Boolean);
      gbpServiceAreas = Array.isArray(loc?.serviceArea?.places) ? loc.serviceArea.places : [];
      if (loc) {
        const { serviceLabel } = require('../gbp/intelligence/normalize');
        gbpListedServices = (loc.services || []).map(serviceLabel).filter(Boolean);
        gbpDescription = String(loc.profile?.description || '') || null;
      }
    } catch { /* no connected profile — Google's public listing is enough */ }
    // Areas searched one by one from their own location. A connected Google
    // profile's service areas; for a free report (no connection) the places
    // the business's own website says it serves ("Mohali, Chandigarh,
    // Panchkula, Zirakpur") — Nov 2026: a free report searched only around
    // the address and showed "#1 everywhere" for a studio claiming 4 cities.
    let searchServiceAreas: Array<{ placeName: string | null; placeId: string | null }> = gbpServiceAreas;
    let serviceAreaSource: 'google' | 'website' | 'city' = 'google';
    if (audit.fastMode && !gbpServiceAreas.length && websiteIntel?.serviceAreas?.length) {
      const { websiteServiceAreaPlaces } = require('./areaDiscovery');
      const fromSite = websiteServiceAreaPlaces(websiteIntel.serviceAreas.map((a: any) => String(a?.value || '')), resolvedCity);
      if (fromSite.length) {
        searchServiceAreas = fromSite;
        serviceAreaSource = 'website';
      }
    }
    // A business that goes to its customers (address hidden / service-area)
    // with no areas listed anywhere: searched from its city's centre too, not
    // only from the hidden address (Part C.4, answer 2 "served how").
    if (audit.fastMode && !searchServiceAreas.length && understanding?.servedHow === 'service_area' && resolvedCity) {
      searchServiceAreas = [{ placeName: resolvedCity, placeId: null }];
      serviceAreaSource = 'city';
    }
    // The trade comes from the business's Google categories (primary, the
    // public listing's additional ones, a connected profile's). Website
    // services decide it only when every Google category is vague ("Shop",
    // "Service") — then every service searched counts, not just the first.
    const listingView = ownListingAsPublicProfile(publicProfileFromObservations(observations), ownListing);
    const listingCategories: string[] = [
      listingView.category,
      ...(listingView.additionalCategories || []),
      ...(ownListing?.additionalCategories || []),
      // Google Places types of the listing ("meal_takeaway" → "meal takeaway");
      // "point_of_interest" / "establishment" carry no trade and drop out.
      ...(Array.isArray(business.googleTypes) ? business.googleTypes : []).map((t: string) => String(t).replace(/_/g, ' ')),
    ].filter((c): c is string => !!c);
    const googleCategories = [resolvedCategory, ...listingCategories, ...gbpCategories];
    const googleTradeKnown = googleCategories.some((c) => specificWords(c).length > 0);
    // Fallback order — the first source that names a trade decides it:
    //   1. Google categories (primary, listing, place types, connected profile)
    //   2. a description: connected profile, Google listing, the owner's
    //   3. the business name ("Durva Fireworks")
    //   4. the website's title / description
    //   5. the website's services (as searched)
    //   none → the free report shows no competitors (below).
    // 2–4 only accept a KNOWN trade (tradeFromText), never a random word.
    const { tradeFromText } = require('./competitorRelevance');
    const listingSnippet = observations.find((o) => o.status === 'ok' && o.target)?.target?.snippet ?? ownListing?.snippet ?? null;
    const textTrade = (source: string, texts: Array<string | null | undefined>) => {
      const term = tradeFromText(texts);
      const p = term ? buildTradeProfile({ category: term }) : null;
      if (p) p.basis = [`${source}: ${term}`];
      return p;
    };
    const tradeProfile = googleTradeKnown
      ? buildTradeProfile({
          searchCategory: websiteSearchPhrase ? null : searchCategory,
          category: resolvedCategory,
          additionalCategories: [...listingCategories, ...gbpCategories],
        })
      : (understanding
          ? (() => {
              const p = buildTradeProfile({ category: understanding!.searchTerms[0], additionalCategories: understanding!.searchTerms.slice(1, 4) });
              if (p) p.basis = [`understood from the listing: ${understanding!.trade}`];
              return p;
            })()
          : null)
        ?? textTrade('description', [gbpDescription, listingSnippet, business.description])
        ?? textTrade('business name', [business.name])
        ?? textTrade('website', [websiteIntel?.title, websiteIntel?.description?.value])
        ?? buildTradeProfile({
          searchCategory,
          category: resolvedCategory,
          additionalCategories: websiteServices.slice(0, 6).map(toSearchPhrase),
        });
    const classifyOpts = { strictCategory: googleTradeKnown };
    // "Enough real competitors found, or search further out?" For an
    // understood business (free report) this counts only businesses whose
    // Google category is one the AI named as the same trade, or the business's
    // own categories — exact names, no word matching (Nov 2026: "health" made
    // a women's clinic count for a psychologist, so the search stopped early).
    // The final list is still decided by the AI judge (S5).
    const sameTradeNames = new Set(
      (understanding
        ? [...understanding.sameTradeCategories, resolvedCategory, ...(ownListing?.additionalCategories || [])]
        : [])
        .map((c) => String(c || '').trim().toLowerCase())
        .filter((c) => c && !PLACEHOLDER_CATEGORY.test(c)),
    );
    const countedIn = (obs: SearchObservation[]) =>
      understanding && sameTradeNames.size
        ? competitorsFromObservations(obs).filter((c) =>
            [c.category, ...(c.additionalCategories || [])].some((x) => sameTradeNames.has(String(x || '').trim().toLowerCase())),
          ).length
        : tradeProfile
          ? competitorsFromObservations(obs).filter((c) =>
              classifyCompetitor({ name: c.name, category: c.category, additionalCategories: c.additionalCategories, snippet: c.snippet, keywords: c.keywords }, tradeProfile, classifyOpts).counted,
            ).length
          : Infinity; // trade unknown → no basis to judge "insufficient" → no expansion

    let areaObs: SearchObservation[] = cachedRank ? (cachedRank.areaObservations || []) : [];
    let areaDiscovery: any = cachedRank ? (cachedRank.areaDiscovery || null) : null;
    // Service areas actually searched, with their coordinates (for service × area searches).
    const searchedAreas: Array<{ label: string; name: string; placeId: string | null; point: { lat: number; lng: number }; distanceKm: number }> = [];
    const pin = businessForRankings.coordinates?.lat && businessForRankings.coordinates?.lng
      ? { lat: Number(businessForRankings.coordinates.lat), lng: Number(businessForRankings.coordinates.lng) }
      : null;
    if (!cachedRank && pin && searchCategory && rankData && !rankData.fetchError) {
      try {
        const { discoverCompetitorAreas, AREA_DISCOVERY_LIMITS, WEBSITE_AREA_LIMITS, haversineKm } = require('./areaDiscovery');
        const { resolvePlacePoint } = require('./localities');
        const { fetchAreaObservations } = require('./seoAnalyzer');
        const res = await discoverCompetitorAreas(
          { pin, searchTerm: understoodPick?.mainTerm || searchCategory, serviceAreas: searchServiceAreas },
          {
            // "Chandigarh, Punjab" geocodes ~80 km away (Chandigarh is not in
            // Punjab): a website area that lands too far is looked up again
            // by its name alone.
            resolve: async (a: any) => {
              const p = await resolvePlacePoint(a, business.state || resolvedCity);
              if (serviceAreaSource === 'google' || (p && haversineKm(pin, p) <= WEBSITE_AREA_LIMITS.maxDistanceKm)) return p;
              return (await resolvePlacePoint(a, null)) ?? p;
            },
            search: (searches: any[]) => fetchAreaObservations(businessForRankings, searches),
            relevantCount: (obs: SearchObservation[]) => countedIn([...marketObs, ...obs]),
          },
          serviceAreaSource !== 'google' ? WEBSITE_AREA_LIMITS : AREA_DISCOVERY_LIMITS,
        );
        areaObs = res.observations;
        for (const x of res.searched as any[]) {
          if (x.kind === 'service_area' && !searchedAreas.some((a) => a.label === x.label)) {
            searchedAreas.push({ label: x.label, name: x.areaName || x.label, placeId: x.placeId ?? null, point: x.point, distanceKm: x.distanceKm });
          }
        }
        areaDiscovery = {
          serviceAreasConfigured: searchServiceAreas.length,
          serviceAreaSource,
          searched: res.searched.map((x: any) => ({ label: x.label, kind: x.kind, keyword: x.keyword, distanceKm: x.distanceKm, areaName: x.areaName, placeId: x.placeId ?? null })),
          skipped: res.skipped,
          expandedToKm: res.expandedToKm,
        };
      } catch (adErr: any) {
        console.warn('[auditService] competitor area discovery failed:', adErr?.message);
      }
    }

    // ── SEO intelligence (full audits only): stable tracked keywords per
    // service, and service × area searches. The free report is unchanged.
    // Kept out of the business's headline ranking statistics; used for
    // service / area visibility, competitors and the monthly comparison.
    const seoIntel: {
      services: any[]; tracked: any[]; keywordChanges: any[]; trackedObs: SearchObservation[]; serviceAreaObs: SearchObservation[];
      searchTerms: Array<{ keyword: string; impressions: number; period?: string }>; prevPlan: any; prevAudit: any; serviceOf: (k: string) => { id: string; name: string } | null;
      /** Keyword system research (docs/KEYWORD_SYSTEM_PLAN.md); null when it could not run. */
      keywordResearch: import('../seo/keywordPipeline').KeywordPipelineResult | null;
    } | null = await (async () => {
      if (audit.fastMode || !rankData || rankData.fetchError || !searchCategory) return null;
      try {
        const { verifiedServices, buildTrackedKeywords, serviceForKeyword } = require('../seo/trackedKeywords');
        const { fetchTrackedObservations, fetchAreaObservations } = require('./seoAnalyzer');
        const SeoPlan = require('../../models/SeoPlan').default;
        const GBPKeyword = require('../../models/GBPKeyword').default;
        const prevPlan: any = await SeoPlan.findOne({ businessId: business._id, status: 'active' }).sort({ version: -1 }).lean();
        // A monthly report measures its SEO-plan outcomes since last month's report.
        const prevAudit: any = ((audit as any).auditKind || auditKindOf(audit)) === 'monthly'
          ? await previousMonthlyReport(audit, '_id')
          : await Audit.findOne({ businessId: business._id, status: 'COMPLETED', fastMode: { $ne: true }, _id: { $ne: audit._id }, 'auditData.facts.tracking': { $exists: true } })
            .sort({ createdAt: -1 }).select('createdAt').lean();
        const latest: any = await GBPKeyword.findOne({ businessId: business._id }).sort({ year: -1, month: -1 }).select('year month').lean();
        const searchTerms = latest
          ? (await GBPKeyword.find({ businessId: business._id, year: latest.year, month: latest.month, impressions: { $gt: 0 } })
              .sort({ impressions: -1 }).limit(50).select('keyword impressions').lean() as any[])
              .map((t) => ({ keyword: String(t.keyword), impressions: Number(t.impressions), period: `${latest.year}-${String(latest.month).padStart(2, '0')}` }))
          : [];
        const services = verifiedServices({
          gbpServices: gbpListedServices || [],
          ownerServices: String(business.services || '').split(/[,;\n]+/),
          websiteServices,
          category: searchCategory,
        });
        const serviceOf = (k: string) => { const s = serviceForKeyword(k, services); return s ? { id: s.id, name: s.name } : null; };
        const plan = buildTrackedKeywords({
          previous: prevPlan?.trackedKeywords || [],
          services,
          city: resolvedCity,
          gridKeywords: Array.from(new Set(marketObs.filter((o) => o.kind === 'primary' || o.kind === 'discovery').map((o) => o.keyword))),
          searchTerms,
          proposed: (prevPlan?.draft?.proposedKeywords || []).map((p: any) => (typeof p === 'string' ? p : p?.keyword)).filter(Boolean),
          businessName: business.name,
          now: new Date(),
        });
        const trackedObs: SearchObservation[] = await fetchTrackedObservations(businessForRankings, plan.measureNow.map((k: any) => k.keyword));
        // Service × area: the first 3 services in the 3 nearest searched service areas (≤ 9 searches).
        const svcAreaSearches = searchedAreas.slice(0, 3).flatMap((a) =>
          services.slice(0, 3).map((s: any) => ({ keyword: `${s.name} ${a.name}`, point: a.point, label: a.label })));
        const serviceAreaObs: SearchObservation[] = await fetchAreaObservations(businessForRankings, svcAreaSearches);

        // Keyword system: research, volume for every candidate, rank checks
        // (reusing the searches above), selection of the month's targets.
        const { runKeywordPipeline } = require('../seo/keywordPipeline');
        const sameTrade = competitorsFromObservations(marketObs).filter((c) =>
          !tradeProfile || classifyCompetitor({ name: c.name, category: c.category, additionalCategories: c.additionalCategories, snippet: c.snippet, keywords: c.keywords }, tradeProfile, classifyOpts).counted);
        const keywordResearch = await runKeywordPipeline({
          business,
          businessForRankings,
          services,
          category: searchCategory,
          city: resolvedCity,
          place: { city: resolvedCity, area: business.area, state: business.state, country: business.country },
          serviceAreas: Array.from(new Set([
            ...searchedAreas.map((a) => a.name),
            ...gbpServiceAreas.map((a) => a.placeName).filter(Boolean) as string[],
          ])),
          gbpSearchTerms: searchTerms,
          existingObservations: [...marketObs, ...trackedObs, ...serviceAreaObs],
          competitors: sameTrade.map((c) => ({ name: c.name, website: c.website })),
          previous: prevPlan?.keywordSet || [],
          ownerRemoved: prevPlan?.ownerRemovedKeywords || [],
        });
        return { services, tracked: plan.tracked, keywordChanges: plan.changes, trackedObs, serviceAreaObs, searchTerms, prevPlan, prevAudit, serviceOf, keywordResearch };
      } catch (siErr: any) {
        console.warn('[auditService] SEO intelligence measurement failed:', siErr?.message);
        return null;
      }
    })();

    // ── Facts: competitors (real businesses observed above the target) ──
    const competitorObs = [...marketObs, ...areaObs, ...competitorSearchObs, ...(seoIntel ? [...seoIntel.trackedObs, ...seoIntel.serviceAreaObs] : [])];
    let competitorFacts: CompetitorFact[] = competitorsFromObservations(competitorObs);
    let aheadFacts = competitorsAhead(competitorObs);

    // ── Same-trade check: only businesses in the target's trade are competitors ─
    // Google shows every kind of business for a search; the rest are kept as
    // "other businesses shown above you", never counted (competitorRelevance.ts).
    let otherBusinessesAhead: Array<{ name: string; category: string | null; level: string; signals: string[]; foundIn: string[] }> = [];
    // How competitors were decided: 'ai' / 'reused' (S5 judge) or 'rules (…)'.
    let competitorJudgeUsed: string = 'rules';
    // Same-trade businesses ranked BELOW this one (AI-confirmed), shown only
    // when fewer than 3 confirmed competitors rank above — never counted as "ahead".
    let similarNearby: Array<{ name: string; category: string | null; rating: number | null; reviewCount: number | null; bestPosition: number; searches: number; reason: string }> = [];
    const tradeBasis: string[] = tradeProfile?.basis ?? [];
    // Free report with no trade known from Google OR the website: nobody can
    // be shown as a competitor (Nov 2026: a food business was shown every
    // business above it because nothing was filtered). Listed as "other
    // businesses" only.
    if (competitorFacts.length && !tradeProfile && audit.fastMode) {
      otherBusinessesAhead = competitorFacts.slice(0, 40).map((c) => ({
        name: c.name, category: c.category, level: 'unverified', signals: ['trade of this business unknown'], foundIn: c.foundIn || [],
      }));
      competitorFacts = [];
      aheadFacts = { ...aheadFacts, count: 0, names: [] };
    }
    if (competitorFacts.length && tradeProfile) {
      const classify = (c: CompetitorFact, websiteText?: string) =>
        classifyCompetitor({ name: c.name, category: c.category, additionalCategories: c.additionalCategories, snippet: c.snippet, websiteText, keywords: c.keywords }, tradeProfile, classifyOpts);
      competitorFacts.forEach((c) => { c.tradeMatch = classify(c); });
      // Generic-category businesses not yet confirmed: what their own website
      // says (≤5 sites, 2 pages, cached per domain — no paid API).
      const toRead = competitorFacts.filter((c) => c.website && c.tradeMatch && c.tradeMatch.level !== 'confirmed' && c.tradeMatch.level !== 'unrelated').slice(0, 5);
      const sites = await Promise.all(toRead.map((c) => getWebsiteIntelligence(c.website!, { maxPages: 2 }).catch(() => null)));
      toRead.forEach((c, i) => {
        const intel: any = sites[i];
        if (!intel || intel.status === 'failed') return;
        const text = [intel.title, intel.description?.value, ...(intel.services || []).map((s: any) => s.value)].filter(Boolean).join(' . ');
        c.tradeMatch = classify(c, text);
      });
      // ── S5: the AI judges each business against what this one does ──
      // (free report, understood business). Replaces the word-matching
      // verdict; the rules above stay only if the AI fails. Judged: the 40 seen
      // above the target most often; the rest are not shown as competitors.
      if (audit.fastMode && understanding) {
        const { judgeCompetitors, MAX_JUDGED, MAX_BELOW_JUDGED } = require('./competitorJudge');
        const ordered = [...competitorFacts].sort((a, b) =>
          (b.foundIn?.length || 0) - (a.foundIn?.length || 0) || b.searchesAhead - a.searchesAhead);
        const target = {
          name: business.name || '', trade: understanding.trade, offerings: understanding.offerings.map((o) => o.name),
          primaryCategory: resolvedCategory, additionalCategories: ownListing?.additionalCategories || [],
          servedHow: understanding.servedHow, city: resolvedCity,
        };
        const candidates = ordered.slice(0, MAX_JUDGED - MAX_BELOW_JUDGED).map((c) => ({
          key: c.key, name: c.name, category: c.category, additionalCategories: c.additionalCategories || [], snippet: c.snippet || null,
        }));
        // Businesses Google showed BELOW this one in the same searches — judged
        // in the same call, shown as "like yours nearby" when fewer than 3
        // confirmed competitors rank above (no extra search, no extra cost).
        const aheadKeys = new Set(competitorFacts.map((c) => c.key));
        const belowMap = new Map<string, { key: string; name: string; category: string | null; additionalCategories: string[]; snippet: string | null; rating: number | null; reviewCount: number | null; bestPosition: number; searches: number }>();
        for (const o of competitorObs) {
          if (o.status !== 'ok') continue;
          for (const r of o.others || []) {
            const key = competitorKey(r as any);
            if (aheadKeys.has(key) || !r.name) continue;
            const e = belowMap.get(key) || { key, name: r.name, category: r.category ?? null, additionalCategories: r.additionalCategories || [], snippet: r.snippet ?? null, rating: r.rating ?? null, reviewCount: r.reviewCount ?? null, bestPosition: r.position, searches: 0 };
            e.searches++;
            e.bestPosition = Math.min(e.bestPosition, r.position);
            belowMap.set(key, e);
          }
        }
        const below = [...belowMap.values()].sort((a, b) => b.searches - a.searches || a.bestPosition - b.bestPosition).slice(0, MAX_BELOW_JUDGED);
        candidates.push(...below.map((b) => ({ key: b.key, name: b.name, category: b.category, additionalCategories: b.additionalCategories, snippet: b.snippet })));
        const jStart = Date.now();
        const j = await judgeCompetitors(target, candidates, { saved: (business as any).competitorJudgement ?? null });
        timings.competitorJudgeMs = Date.now() - jStart;
        if (j.judgements) {
          if (j.saved && !j.reused) {
            await Business.updateOne({ _id: business._id }, { $set: { competitorJudgement: j.saved } })
              .catch((e: any) => console.warn('[auditService] could not save competitorJudgement:', e?.message));
          }
          const levelOf = { yes: 'confirmed', no: 'unrelated', unsure: 'unverified' } as const;
          competitorFacts.forEach((c) => {
            const v = j.judgements!.get(c.key);
            c.tradeMatch = v
              ? { level: levelOf[v.verdict as 'yes' | 'no' | 'unsure'], counted: v.verdict === 'yes', signals: [`AI: ${v.reason}`] }
              : { level: 'unverified', counted: false, signals: ['not judged (seen above you less often)'] };
          });
          const confirmedAbove = competitorFacts.filter((c) => c.tradeMatch?.counted).length;
          if (confirmedAbove < 3) {
            similarNearby = below
              .filter((b) => j.judgements!.get(b.key)?.verdict === 'yes')
              .sort((a, b) => a.bestPosition - b.bestPosition)
              .slice(0, 5)
              .map((b) => ({ name: b.name, category: b.category, rating: b.rating, reviewCount: b.reviewCount, bestPosition: b.bestPosition, searches: b.searches, reason: j.judgements!.get(b.key)!.reason }));
          }
          competitorJudgeUsed = j.reused ? 'reused' : 'ai';
        } else {
          console.warn('[auditService] competitor judge unavailable — word-matching result kept:', j.error);
          competitorJudgeUsed = `rules (${j.error})`;
        }
      }
      otherBusinessesAhead = competitorFacts
        .filter((c) => !c.tradeMatch!.counted)
        .slice(0, 40)
        .map((c) => ({ name: c.name, category: c.category, level: c.tradeMatch!.level, signals: c.tradeMatch!.signals, foundIn: c.foundIn || [] }));
      // Same trade first, then the widest overlap with the business's markets.
      const levelRank = (c: CompetitorFact) => (c.tradeMatch!.level === 'confirmed' ? 0 : 1);
      competitorFacts = competitorFacts
        .filter((c) => c.tradeMatch!.counted)
        .sort((a, b) =>
          levelRank(a) - levelRank(b) ||
          (b.foundIn?.length || 0) - (a.foundIn?.length || 0) ||
          b.searchesAhead - a.searchesAhead ||
          (a.averageObservedRank ?? 99) - (b.averageObservedRank ?? 99),
        );
      aheadFacts = { ...aheadFacts, count: competitorFacts.length, names: competitorFacts.map((c) => c.name) };
    }

    // ── Competitor keyword gap (free report; Part C step 7) ───────────────
    // Keywords the top same-trade competitor's website targets, with real
    // searches, that this business really offers (grounded in its own words)
    // and that are not in its shortlist → the business is rank-checked on the
    // best 2. Kept out of the ranking statistics. FREE_REPORT_COMPETITOR_SITES
    // = how many competitor sites to read (default 1, 0 = off; ~$0.09 each).
    let competitorKeywordGaps: Array<{ keyword: string; volume: number | null; competitor: string; yourRank: number | null; measured: boolean }> =
      cachedRank ? (cachedRank.competitorKeywordGaps || []) : [];
    if (!cachedRank && audit.fastMode && understoodPick && understandingEvidence && rankData && !rankData.fetchError) {
      const sitesWanted = Math.max(0, Math.min(3, Number(process.env.FREE_REPORT_COMPETITOR_SITES ?? 1) || 0));
      const withSite = competitorFacts
        .filter((c) => c.website && c.searchesAhead > 0 && (!c.tradeMatch || c.tradeMatch.level === 'confirmed'))
        .slice(0, sitesWanted);
      if (withSite.length) {
        try {
          const { fetchSiteKeywords } = require('./keywordIdeasClient');
          const { groundedInBusiness } = require('./freeReportShortlist');
          const { fetchKeywordRankSnapshot } = require('./seoAnalyzer');
          const lists: any[][] = await Promise.all(withSite.map((c) => fetchSiteKeywords(c.website!, { countryHint: business.country || '' }).catch(() => [])));
          const have = new Set(understoodPick.picked.map((p) => p.keyword.toLowerCase()));
          const places = [resolvedCity, ...understoodPick.areas];
          const seen = new Set<string>();
          const best = lists
            .flatMap((list, i) => list.map((k: any) => ({ keyword: String(k?.keyword || '').toLowerCase().trim(), volume: typeof k?.volume === 'number' ? k.volume : null, competitor: withSite[i].name })))
            .filter((k) => {
              if (!k.keyword || (k.volume ?? 0) <= 0 || have.has(k.keyword) || seen.has(k.keyword)) return false;
              if (/\b(best|top|cheapest)\b/.test(k.keyword) || k.keyword.split(' ').length > 6) return false;
              seen.add(k.keyword);
              return groundedInBusiness(k.keyword, understandingEvidence, places);
            })
            .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
            .slice(0, 2);
          if (best.length) {
            const snap = await fetchKeywordRankSnapshot(businessForRankings, best.map((k) => k.keyword), { kindOf: () => 'discovery' });
            competitorKeywordGaps = best.map((k, i) => {
              const o: any = snap[i]?.observation;
              const measured = !!o && o.status === 'ok';
              return { ...k, yourRank: measured && o.found ? o.rank : null, measured };
            });
          }
        } catch (ckErr: any) {
          console.warn('[auditService] competitor keyword gap skipped:', ckErr?.message);
        }
      }
    }

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
      // Same-trade check here too: a Places hit of another trade is not a
      // competitor. None left → the report shows no competitors, not random ones.
      placesFallback = (res.accepted || []).filter((c: any) =>
        tradeProfile
          ? classifyCompetitor({ name: c.name, category: c.category, additionalCategories: c.additionalCategories }, tradeProfile, classifyOpts).counted
          : !audit.fastMode);
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

    // ── Visibility per service area (stored; every report variant + PDF read it) ─
    let areaVisibility: AreaVisibilityFacts | null = null;
    // ONE volume lookup for every phrase measured this audit (area, tracked,
    // service × area and the keyword table's) — the keyword table below then
    // reads them all from the 45-day cache.
    let volumes = new Map<string, number | null>();
    if (searchServiceAreas.length || seoIntel) {
      const { fetchSearchVolumes } = require('./keywordVolumeClient');
      const phrases = [
        ...areaObs.map((o) => o.keyword),
        ...(seoIntel ? [...seoIntel.trackedObs, ...seoIntel.serviceAreaObs, ...(seoIntel.keywordResearch?.observations || [])].map((o) => o.keyword) : []),
        ...rankingFacts.byKeyword.filter((k) => k.kind !== 'brand').map((k) => k.keyword),
      ];
      volumes = await fetchSearchVolumes(phrases, { countryHint: business.country || '' }).catch(() => new Map());
    }
    if (searchServiceAreas.length) {
      try {
        const { buildAreaVisibility } = require('./areaVisibility');
        areaVisibility = buildAreaVisibility({
          source: serviceAreaSource,
          serviceAreas: searchServiceAreas,
          discovery: areaDiscovery,
          areaObservations: areaObs,
          primaryObservations: marketObs,
          competitors: competitorFacts.filter((c) => c.source === 'dataforseo'),
          volumes,
          primaryLabel: AROUND_ADDRESS,
        });
      } catch (avErr: any) {
        console.warn('[auditService] service-area visibility failed:', avErr?.message);
      }
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
          { city: resolvedCity, area: business.area || '', state: business.state || '', country: business.country || '' },
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
            areaObservations: areaObs,
            competitorObservations: competitorSearchObs,
            competitorKeywordGaps,
            areaDiscovery,
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

    // ── Tracking facts: measurements per (keyword, location), changes vs the
    // previous full audit, and visibility per service / service × area ──
    let tracking: any = null;
    if (seoIntel) {
      try {
        const { measurementRows, buildKeywordMovement, addressArea, monthlyHistoryAudits, RANK_HISTORY_FETCH, RANK_HISTORY_KINDS } = require('../seo/measurements');
        const { buildServiceVisibility } = require('../seo/serviceVisibility');
        const { areaId } = require('../seo/ids');
        const home = addressArea(AROUND_ADDRESS);
        const areaByLabel = new Map(searchedAreas.map((a) => [a.label, { id: areaId({ placeId: a.placeId, name: a.name }), name: a.name }]));
        const serviceAreaSearches = [...areaObs, ...seoIntel.serviceAreaObs].filter((o) => o.area && areaByLabel.has(o.area));
        const measurements = [
          ...measurementRows(marketObs, { scope: 'address_grid', areaOf: () => home, serviceOf: seoIntel.serviceOf, volumes }),
          // A keyword the keyword stage re-searched at more points replaces its tracked rows (one grid per keyword).
          ...measurementRows(addressTrackedObs(seoIntel.trackedObs, seoIntel.keywordResearch?.observations || []), { scope: 'address_tracked', areaOf: () => home, serviceOf: seoIntel.serviceOf, volumes }),
          ...measurementRows(serviceAreaSearches, { scope: 'service_area', areaOf: (o: SearchObservation) => areaByLabel.get(o.area!)!, serviceOf: seoIntel.serviceOf, volumes }),
        ];
        // Month-on-month movement + comparable history, from the measurements
        // earlier connected audits already stored (database read only — no new
        // searches): the latest connected audit of each earlier month, one per
        // month; months[0] is the baseline this report compares with.
        const measuredAt = new Date().toISOString();
        const earlier: any[] = await Audit.find({
          businessId: business._id, status: 'COMPLETED', fastMode: { $ne: true }, _id: { $ne: audit._id },
          auditKind: { $in: [...RANK_HISTORY_KINDS] },
          'auditData.facts.tracking.measurements': { $exists: true },
        }).sort({ createdAt: -1 }).limit(RANK_HISTORY_FETCH)
          .select('createdAt auditData.facts.tracking.measuredAt auditData.facts.tracking.measurements').lean();
        const months = monthlyHistoryAudits(
          earlier.map((a) => ({ id: String(a._id), at: a.auditData?.facts?.tracking?.measuredAt || new Date(a.createdAt).toISOString(), measurements: a.auditData?.facts?.tracking?.measurements || [] })),
          measuredAt,
        );
        const changes = buildKeywordMovement({ at: measuredAt, measurements }, months);
        const websiteText = websiteIntel && websiteIntel.status !== 'failed'
          ? [websiteIntel.title, websiteIntel.metaDescription, websiteIntel.description?.value, ...(websiteIntel.headings || []).map((h: any) => h.value), ...(websiteIntel.services || []).map((x: any) => x.value)].filter(Boolean).join(' . ')
          : null;
        const visibility = buildServiceVisibility({
          services: seoIntel.services,
          measurements,
          changes,
          observations: [...marketObs, ...seoIntel.trackedObs, ...serviceAreaSearches],
          serviceOf: seoIntel.serviceOf,
          competitors: competitorFacts.filter((c) => c.source === 'dataforseo'),
          searchTerms: seoIntel.searchTerms,
          gbpServiceNames: gbpListedServices,
          websiteText,
          reviewCount: lifetimeCount,
        });
        tracking = {
          version: 1,
          measuredAt,
          // The monthly baseline the keyword changes were compared with.
          previousAuditId: months[0]?.id ?? null,
          previousMeasuredAt: months[0]?.at ?? null,
          services: seoIntel.services,
          tracked: seoIntel.tracked,
          keywordChanges: seoIntel.keywordChanges,
          measurements,
          changes,
          serviceVisibility: visibility.services,
          matrix: visibility.matrix,
          searchTerms: seoIntel.searchTerms.slice(0, 15),
          searches: { tracked: seoIntel.trackedObs.length, serviceArea: seoIntel.serviceAreaObs.length },
          websiteSeo: business.website
            ? require('../seo/websiteSeo').analyzeWebsiteSeo({
                pages: websiteIntel && websiteIntel.status !== 'failed' ? websiteIntel.pageSeo : null,
                services: seoIntel.services,
                serviceAreas: gbpServiceAreas.map((a) => a.placeName).filter(Boolean) as string[],
                siteText: [websiteText || '', ...(websiteIntel?.serviceAreas || []).map((a: any) => a.value), String(websiteIntel?.fr4Signals?.textSample || '')].join(' . '),
                gbpServiceNames: gbpListedServices,
              })
            : { status: 'not_measured', reason: 'No website on the profile.', pagesChecked: 0, items: [] },
        };
      } catch (trErr: any) {
        console.warn('[auditService] tracking facts failed:', trErr?.message);
      }
    }

    // ── Competitor intelligence ─────────────────────────────────────────
    // Public listing fields come free with the ranking results. Website
    // research is selective: only the 3 competitors seen above the target
    // most often, 2 pages each, cached per domain (HTTP only — no paid API).
    const publicProfile = ownListingAsPublicProfile(publicProfileFromObservations(observations), ownListing);
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
    // GBP Intelligence (FR-3.2): the 6-hourly sync already read the full
    // listing into GbpLocationSnapshot. When that read is fresh it replaces
    // this audit's own live read (one less Google call) and adds the sections
    // the live read never covered (hours, services, attributes, media, posts,
    // verification, duplicates, external changes). Otherwise the original
    // live read below runs unchanged.
    let gbpIntel: any = null;
    if (depth === 'full' && business.googleLocationId) {
      try {
        const { getGbpSnapshot } = require('../gbp/intelligence/runner');
        const { snapshotUsableForAudit, gbpLiveFromSnapshot } = require('../gbp/intelligence/auditInput');
        const snap = await getGbpSnapshot(audit.businessId.toString());
        if (snap && snapshotUsableForAudit(snap, new Date())) {
          gbpIntel = snap;
          gbpLive = gbpLiveFromSnapshot(snap);
        }
      } catch (sErr: any) {
        console.warn('[auditService] GBP intelligence snapshot unavailable:', sErr?.message);
      }
    }
    if (!gbpLive && depth === 'full' && business.googleLocationId) {
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
    const intelApi = gbpIntel ? require('../gbp/intelligence/auditInput') : null;
    const profileCompletionPayload = calculateProfileCompletion(businessObj, {
      gbpLive,
      publicProfile,
      gbpIntelStates: intelApi ? intelApi.checklistStatesFromSnapshot(gbpIntel) : undefined,
    });
    const profileCompletion: any = profileCompletionPayload.data;
    // Measured over more fields than a plain live read → never compared
    // like-for-like with audits that lacked it (compareAudits).
    if (gbpIntel) profileCompletion.completionBasis = 'gbp_intelligence';
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
      competitorKeywordGaps,
      serviceGap: (() => {
        if (!websiteServices.length) return null;
        const { websiteServicesNotOnGoogle } = require('./freeReportShortlist');
        const onGbp = Array.isArray(gbpListedServices) && gbpListedServices.length > 0;
        const missing: string[] = onGbp
          ? websiteServicesNotOnGoogle(websiteServices, gbpListedServices)
          : websiteServicesNotOnGoogle(websiteServices, [resolvedCategory, ...(ownListing?.additionalCategories || []), ...gbpCategories]);
        return missing.length ? { missing, against: onGbp ? 'gbp_services' as const : 'categories' as const } : null;
      })(),
      categoryGap: (() => {
        const { categoriesCompetitorsUse } = require('./freeReportShortlist');
        const above = competitorFacts.filter((c: any) => c.searchesAhead > 0 && (!c.tradeMatch || c.tradeMatch.level === 'confirmed'));
        const rows = categoriesCompetitorsUse([resolvedCategory, ...(ownListing?.additionalCategories || []), ...gbpCategories], above);
        return rows.length ? rows : null;
      })(),
      areaCoverage: (() => {
        const cov = require('./areaVisibility').areaCoverage(areaVisibility);
        return cov ? { ...cov, source: serviceAreaSource } : null;
      })(),
      // Fields read from the GBP API are labelled gbp_api, not google_places.
      fieldSources: intelApi
        ? intelApi.fieldSourcesFromSnapshot(gbpIntel)
        : gbpLive
          ? Object.fromEntries(['Business Name', 'Primary Category', 'Phone', 'Website', 'Business Description', 'Additional Categories'].map((f) => [f, 'gbp_api' as const]))
          : undefined,
    });
    const findings = [...builtFindings];
    const gbpChangesSince = new Date(Date.now() - 35 * 86_400_000);
    if (intelApi) {
      evidence.push(...intelApi.gbpIntelligenceEvidence(gbpIntel, new Date()));
      findings.push(...intelApi.gbpIntelligenceFindings(gbpIntel, { websiteServices, changesSince: gbpChangesSince, now: new Date() }));
    }

    // FR-4 is additive. overallScore stays the profile-completion percentage.
    const fr4Now = new Date();
    const locationData = gbpIntel?.sections?.location?.meta?.status === 'SUCCESS' ? gbpIntel.sections.location.data : null;
    const mediaData = gbpIntel?.sections?.media?.meta?.status === 'SUCCESS' ? gbpIntel.sections.media.data : null;
    const postsData = gbpIntel?.sections?.posts?.meta?.status === 'SUCCESS' ? gbpIntel.sections.posts.data : null;
    const publicPhotos = observations.find((o) => typeof o.target?.totalPhotos === 'number')?.target?.totalPhotos;
    const photoCount = typeof mediaData?.photos === 'number' ? mediaData.photos : typeof publicPhotos === 'number' ? publicPhotos : null;
    const photoStatus = typeof mediaData?.photos === 'number' || typeof publicPhotos === 'number'
      ? 'measured' as const
      : gbpIntel?.sections?.media?.meta?.status === 'NOT_AVAILABLE' ? 'unavailable' as const : 'not_measured' as const;
    const newestPost = postsData?.newestCreateTime ? (fr4Now.getTime() - new Date(postsData.newestCreateTime).getTime()) / 86_400_000 : null;
    const postsLast30 = postsData ? postsInLast30Days(postsData.recent || [], !!postsData.truncated, fr4Now) : null;
    let fr4History: Array<{ at: string; placeId: string | null; name: string; reviewCount: number | null }> | null = null;
    let fr4HistoryAt: string | null = null;
    if (!audit.fastMode) {
      try {
        const prevHist: any = await Audit.findOne({
          businessId: audit.businessId,
          status: 'COMPLETED',
          _id: { $ne: audit._id },
          'auditData.facts.version': { $gte: 1 },
        }).sort({ createdAt: -1 }).select('createdAt auditData.competitors.placeId auditData.competitors.name auditData.competitors.reviewCount auditData.facts.reviews.lifetime.totalCount').lean();
        if (prevHist?.createdAt) {
          fr4HistoryAt = new Date(prevHist.createdAt).toISOString();
          const lifetimePrev = prevHist.auditData?.facts?.reviews?.lifetime?.totalCount;
          fr4History = [
            { at: fr4HistoryAt, placeId: '__subject__', name: '', reviewCount: typeof lifetimePrev === 'number' ? lifetimePrev : null },
            ...((prevHist.auditData?.competitors || []) as any[]).map((c) => ({
              at: fr4HistoryAt as string,
              placeId: c.placeId ?? null,
              name: String(c.name || ''),
              reviewCount: typeof c.reviewCount === 'number' ? c.reviewCount : null,
            })),
          ];
        }
      } catch (histErr: any) {
        console.warn('[auditService] FR-4 history skipped:', histErr?.message);
      }
    }
    const signals = websiteIntel?.fr4Signals || null;
    const crawled = !!signals?.finalUrl;
    const fr4 = assembleFr4({
      score: {
        completionPercentage: profileCompletion.completionPercentage ?? null,
        primaryCategoryState: fieldStates['Primary Category'],
        primaryCategory: locationData?.primaryCategory?.displayName || business.category || null,
        serviceNames: intelApi ? intelApi.gbpServiceNames(gbpIntel) : [],
        servicesState: fieldStates['Services Listed'],
        attributesState: fieldStates['Attributes'],
        photos: { status: photoStatus, count: photoCount, scope: typeof mediaData?.photos === 'number' ? 'owner_media' : photoCount != null ? 'public_listing' : null },
        posts: {
          status: postsData ? 'measured' : gbpIntel?.sections?.posts?.meta?.status === 'NOT_AVAILABLE' ? 'unavailable' : 'not_measured',
          total: postsData ? postsData.total : null,
          newestAgeDays: newestPost != null && Number.isFinite(newestPost) ? Math.floor(newestPost) : null,
        },
        reviews: {
          status: reviewFacts.lifetime.status === 'verified' ? 'measured' : 'not_measured',
          count: reviewFacts.lifetime.status === 'verified' ? reviewFacts.lifetime.totalCount : null,
          medianCompetitorCount: reviewComparison?.medianCompetitorReviewCount ?? null,
        },
      },
      website: {
        crawled,
        title: websiteIntel?.title || null,
        phones: (websiteIntel?.phones || []).map((p: any) => String(p.value || p)),
        textSample: signals?.textSample || null,
        schemaTypes: websiteIntel?.schemaTypes || [],
        jsonLdBlocks: crawled ? signals.jsonLdBlocks ?? 0 : null,
        jsonLdErrors: crawled ? signals.jsonLdErrors ?? 0 : null,
        jsonLdUntyped: crawled ? signals.jsonLdUntyped ?? 0 : null,
        mapEmbeds: crawled ? signals.mapEmbeds || [] : null,
        requestedUrl: signals?.requestedUrl || websiteIntel?.requestedUrl || null,
        finalUrl: signals?.finalUrl || null,
        robotsMeta: signals?.robotsMeta ?? null,
        xRobotsTag: signals?.xRobotsTag ?? null,
        canonical: signals?.canonical ?? null,
        robotsTxtFetched: signals?.robotsTxt?.fetched ?? null,
        robotsTxtDisallowAll: signals?.robotsTxt?.disallowAll ?? null,
        sitemapSeen: signals?.sitemapSeen ?? null,
        pageNoindex: signals?.pageNoindex ?? null,
        gbp: locationData ? {
          name: locationData.title || null,
          phone: locationData.primaryPhone || null,
          address: locationData.address?.formatted || null,
        } : null,
      },
      observations,
      history: fr4History,
      historyAt: fr4HistoryAt,
      now: fr4Now.toISOString(),
      subjectReviewCount: reviewFacts.lifetime.status === 'verified' ? reviewFacts.lifetime.totalCount : null,
      subjectPhotoCount: photoCount,
      subjectPostsLast30Days: postsLast30,
      existingFindings: findings,
    });
    findings.push(...fr4.websiteFindings);
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
          growwmaticsCapability: 'update_booking_link',
          recommendedAction: `Add ${websiteIntel.bookingLinks[0].value} as the appointment link on the Google profile.`,
        });
      }
      // The GBP service list is never read by any code path — so the website's
      // services become a verification step, never "your GBP is missing X".
      const servicesStatus = profileCompletion.checklist.find((c: any) => c.field === 'Services Listed')?.status;
      // The services named in these findings: the real offerings the AI
      // checked against the evidence (S1) — not raw website headings (Nov 2026:
      // "list the 25 services your website describes" were "Follow Us",
      // "Before", "P1.25"…). Without an understanding, menu text, product
      // codes and sentences are filtered out.
      const realServices: string[] = understanding?.offerings.length
        ? understanding.offerings.map((o) => o.name)
        : websiteServices.filter((s) => {
            const t = String(s).trim();
            return /\p{L}{3,}/u.test(t) && t.split(/\s+/).length <= 6 && !/[.:;!?]$/.test(t) &&
              !/^(follow us|before|after|search|home|about( us)?|contact( us)?|faqs?|blog|gallery|products?|services?|our services|our products|read more|learn more|with \w+)$/i.test(t);
          });
      if (realServices.length && servicesStatus === 'Missing') {
        // GBP Intelligence read the service list and it is empty, while the
        // website names services → a real, specific opportunity. It replaces
        // the generic "no services listed" finding (same fact, less useful).
        const generic = findings.findIndex((f) => f.id === 'profile.services_listed.missing');
        if (generic >= 0) findings.splice(generic, 1);
        findings.push({
          id: 'website.services.missing_on_gbp',
          category: 'profile',
          title: `Your website lists ${realServices.length} service${realServices.length === 1 ? '' : 's'}; your Google profile lists none`,
          evidence: `Google Business Profile services: none · Website (${websiteIntel.services[0]?.sourceUrl}): ${realServices.slice(0, 5).join(', ')}${realServices.length > 5 ? '…' : ''}`,
          evidenceIds: ['gbp.services', 'website.services'],
          source: 'gbp_api',
          severity: 'medium',
          confidence: 'high',
          businessImpact: 'Google matches listings to searches partly by the services listed on them.',
          actionability: 'directly_fixable',
          growwmaticsCapability: 'update_services',
          recommendedAction: `Add the services you really offer to the Google profile — your website already names: ${realServices.slice(0, 5).join(', ')}.`,
        });
      } else if (realServices.length && servicesStatus !== 'Complete') {
        findings.push({
          id: 'website.services.verify_on_gbp',
          verificationOnly: true,
          category: 'website',
          title: `Check your Google profile lists the ${realServices.length} service${realServices.length === 1 ? '' : 's'} you offer`,
          evidence: `${understanding?.offerings.length ? 'From your Google listing and website' : `Website (${websiteIntel.services[0]?.sourceUrl})`}: ${realServices.slice(0, 5).join(', ')}${realServices.length > 5 ? '…' : ''}`,
          evidenceIds: ['website.services'],
          source: 'website',
          severity: 'low',
          confidence: 'medium',
          businessImpact: 'Google matches listings to searches partly by the services listed on them; this report could not read your Google service list.',
          actionability: 'directly_fixable',
          growwmaticsCapability: null,
          recommendedAction: `Verify whether your Google Business Profile service list includes: ${realServices.slice(0, 5).join(', ')}.`,
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
      // searchVolume is Google Ads' monthly volume for the WHOLE COUNTRY — never local customers.
      keywordOpportunities: opportunities.map((o) => ({ keyword: o.keyword, demand: o.volumeBand, searchVolumeNationwide: o.searchVolume, found: o.found, rank: o.rank })),
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
              ...collectVerifiedServices(business, { servicePages: websiteServices }, intelApi ? intelApi.gbpServiceNames(gbpIntel) : []),
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
    let areaComparison: AreaComparison | null = null;
    if (lifecycleKind === 'monthly') {
      try {
        const prevForAI: any = await previousMonthlyReport(audit, 'fastMode metadata auditKind auditData.facts.version auditData.facts.ranking auditData.facts.reviews auditData.facts.areaVisibility auditData.profileCompletion auditData.performanceBaseline auditData.fr4.auditScore');
        if (prevForAI && prevForAI.auditData?.facts?.version >= 1) {
          const cmp = compareAudits(
            comparableSnapshot(prevForAI._id.toString(), auditKindOf(prevForAI), prevForAI.createdAt, prevForAI.auditData),
            comparableSnapshot(audit._id.toString(), 'monthly', new Date(), { facts: { ranking: rankingFacts, reviews: reviewFacts }, profileCompletion, performanceBaseline, fr4: fr4.bundle }),
          );
          monthlyContext = cmp.rows.filter((r) => r.change !== 'not_comparable').map((r) => `${r.metric}: ${r.before} → ${r.after} (${r.change})`);
          const ex = await collectExecutions(audit.businessId.toString(), new Date(prevForAI.createdAt), new Date());
          const gm = [ex.posts.length && `${ex.posts.length} Google posts published`, ex.replies.filter((r) => r.by !== 'external').length && `${ex.replies.filter((r) => r.by !== 'external').length} review replies posted`, ex.reviewRequests.sent && `${ex.reviewRequests.sent} review requests sent`].filter(Boolean);
          if (gm.length) monthlyContext.push(`Executed through Growwmatics AI since the last audit: ${gm.join(', ')}`);
          // Per service area, like-for-like with the previous audit (measured lines only).
          if (areaVisibility) {
            const { compareAreaVisibility } = require('./areaVisibility');
            areaComparison = compareAreaVisibility(prevForAI.auditData?.facts?.areaVisibility, areaVisibility);
            for (const l of areaComparison!.improving) monthlyContext.push(`Service-area visibility improved — ${l}`);
            for (const l of areaComparison!.declining) monthlyContext.push(`Service-area visibility declined — ${l}`);
          }
        }
      } catch (mcErr: any) {
        console.warn('[auditService] monthly context skipped:', mcErr?.message);
      }
    }
    // ── Feedback loop: what the previous plan did, BEFORE the new plan ───
    // Action statuses are re-derived now (execution records + this audit's
    // findings), the previous plan is read, and each completed action gets an
    // outcome measured independently of its completion (strategyHistory.ts).
    let strategyHistory: any = null;
    let historyPromptLines: string[] = [];
    if (tracking && seoIntel?.prevPlan) {
      try {
        const { refreshActionStatuses } = require('../lifecycle/actionsSync');
        const { buildStrategyHistory, historyLines } = require('../seo/strategyHistory');
        const actions = await refreshActionStatuses({
          businessId: audit.businessId.toString(),
          auditId: audit._id.toString(),
          auditAt: new Date(),
          currentFindingIds: new Set(findings.map((f: any) => f.id)),
          gbpConnected: !!business.googleLocationId || !!gbpLive,
        }).catch(() => []);
        const since = seoIntel.prevAudit?.createdAt ? new Date(seoIntel.prevAudit.createdAt) : null;
        const Post = require('../../models/Post').default;
        const postKeywords: string[] = since
          ? (await Post.find({ businessId: audit.businessId, 'contentMeta.keyword': { $exists: true }, createdAt: { $gte: since } }).select('contentMeta.keyword').lean() as any[])
              .map((p) => p.contentMeta?.keyword).filter(Boolean)
          : [];
        const prev = seoIntel.prevPlan;
        strategyHistory = buildStrategyHistory({
          previousPlan: {
            version: prev.version, createdAt: new Date(prev.createdAt).toISOString(),
            primaryKeywords: prev.primaryKeywords || [], secondaryKeywords: prev.secondaryKeywords || [],
            postThemes: prev.postThemes || [], priorities: (prev.actionPhases || []).flatMap((p: any) => (p.items || []).map((i: any) => String(i.action || i))).slice(0, 10),
          },
          previousAuditAt: since ? since.toISOString() : null,
          actions: actions.map((a: any) => ({ findingId: a.findingId, description: a.action, status: a.status, capability: a.capability ?? null, executedAt: a.executedAt ?? null, verifiedAt: a.verifiedAt ?? null, statusReason: a.statusReason })),
          changes: tracking.changes,
          postKeywords,
          now: new Date(),
        });
        historyPromptLines = historyLines(strategyHistory);
        tracking.history = strategyHistory;
      } catch (shErr: any) {
        console.warn('[auditService] strategy history skipped:', shErr?.message);
      }
    }
    // Built even without ranking data (e.g. category unknown) — its sections
    // then state what is missing instead of disappearing.
    if (!seoPlanDraft) {
      try {
        const { generateSeoPlanDraft } = require('../ai/seoPlanEngine');
        const verifiedServices = collectVerifiedServices(business, { servicePages: websiteServices }, intelApi ? intelApi.gbpServiceNames(gbpIntel) : []);
        seoPlanDraft = await generateSeoPlanDraft({
          businessName: business.name,
          category: resolvedCategory,
          city: resolvedCity,
          area: business.area || '',
          state: business.state || '',
          country: business.country || '',
          website: business.website || '',
          // Service areas where the business is not yet visible come first — the
          // weekly post themes mention these areas.
          neighbourhoods: Array.from(new Set([
            ...(areaVisibility?.areas || []).filter((a) => a.status === 'measured' && a.bestRank == null).map((a) => a.area),
            ...areasChecked,
          ])),
          // The month's first focus keyword leads the post themes / Q&A when researched.
          primaryKeyword: seoIntel?.keywordResearch?.keywordSet.find((k) => k.role === 'core')?.keyword || rankingFacts.primaryKeyword || keywordTable[0]?.keyword || '',
          keywordTable,
          areaGaps: (areaVisibility?.areas || [])
            .filter((a) => a.status === 'measured')
            .flatMap((a) => a.searches
              .filter((x) => x.status === 'ok' && (x.rank == null || x.rank > 5) && !/near me$/i.test(x.keyword))
              .map((x) => ({ keyword: x.keyword, area: a.area, mapsRank: x.rank }))),
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
            foundIn: c.foundIn,
            source: c.source,
          })),
          searchesChecked: aheadFacts.searchesChecked,
          ranking: { overall: rankingFacts.overall, primary: rankingFacts.primary, notRunReason: rankingNotRunReason },
          reviews: { totalCount: lifetimeCount, rating: reviewFacts.lifetime.rating, sampleSize: reviewFacts.lifetime.sampleSize, allReplied: allReviewsReplied(reviewFacts.recent) },
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
          ownerServices: collectVerifiedServices(business, null, intelApi ? intelApi.gbpServiceNames(gbpIntel) : []),
          websiteIntel,
          publicProfile,
          competitorComparison,
          websiteSearchTerm,
          monthlyContext,
          gbpRead: !!gbpLive,
          websiteSignals,
          gbpLive,
          suspensionRisk,
          gbpIntelligenceLines: intelApi ? intelApi.seoBrainGbpLines(gbpIntel, { changesSince: gbpChangesSince, now: new Date() }) : undefined,
          fr4Lines: fr4.bundle.lines,
          serviceAreaLines: areaStrategyLines(areaVisibility, areaComparison),
          historyLines: historyPromptLines,
          serviceLines: tracking ? require('../seo/serviceVisibility').serviceStrategyLines(tracking.serviceVisibility, tracking.matrix) : [],
          websiteSeoLines: tracking ? require('../seo/websiteSeo').websiteSeoLines(tracking.websiteSeo) : [],
          searchTermLines: (seoIntel?.searchTerms || []).slice(0, 8).map((t) => `"${t.keyword}" — ${t.impressions} impressions (${t.period || 'latest month'}, Google Business Profile)`),
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
    const aheadOut = {
      ...aheadFacts,
      count: checked.competitorsAheadCount,
      names: checked.competitors.map((c) => c.name),
      // Shown above the target but not in its trade — never counted as competitors.
      otherCount: otherBusinessesAhead.length,
      ...(tradeBasis.length ? { tradeBasis } : {}),
    };
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
      // FR-4 score is separate from overallScore, which remains profile completion.
      fr4: fr4.bundle,
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
        otherBusinessesAhead,
        ...(areaDiscovery ? { areaDiscovery, areaSearches: areaObs } : {}),
        ...(areaVisibility ? { areaVisibility } : {}),
        ...(tracking ? { tracking } : {}),
        reviews: reviewFacts,
        reviewComparison,
        profileFields: fieldStates,
        suspensionRisk,
        keywordRows,
        publicProfile,
        competitorComparison,
        websiteSearchTerm,
        // Which category the report searched with, and why (S0) — for checking a customer's report.
        category: { used: resolvedCategory, source: categoryChoice.source, signup: storedCategory || null, googleListing: ownListing?.category ?? null },
        // What the AI understood (S1) and which keywords it led to (S2/S3).
        understanding: understanding
          ? {
              trade: understanding.trade, industry: understanding.industry, servedHow: understanding.servedHow, offered: understanding.offered,
              offerings: understanding.offerings, searchTerms: understanding.searchTerms, confidence: understanding.confidence,
              reused: understandingReused, keywordsPicked: understoodPick?.picked ?? null, mainTerm: understoodPick?.mainTerm ?? null,
              keywordResearch: understoodPick?.research ?? null,
            }
          : { used: false, reason: understandingError || 'low confidence — category rules used' },
        competitorJudge: competitorJudgeUsed,
        similarNearby,
        competitorKeywordGaps,
        // Milliseconds per new free-report step (S0 listing, website wait, S1, S2/S3, S5) — for checking report speed.
        timings,
        // Live GBP field values (connected audits) — the monthly report diffs
        // these between audits to find verified profile changes.
        gbpProfile: gbpLive
          ? { fields: gbpLive, readAt: gbpIntel ? gbpIntel.sections.location.meta.lastSuccessfulFetchAt : new Date().toISOString() }
          : null,
        // GBP Intelligence used by this audit (summary only — the snapshot itself stays in GbpLocationSnapshot).
        gbpIntelligence: intelApi ? intelApi.auditGbpIntelligenceSummary(gbpIntel) : null,
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
        const prevSelect = 'fastMode metadata auditKind createdAt auditData.facts auditData.profileCompletion auditData.performanceBaseline auditData.findings auditData.fr4.auditScore';
        // A monthly report is compared with last month's connected report
        // (previousMonthlyReport) — never a support re-run, a same-month audit
        // or the public free report. Other audits keep the latest earlier one.
        const monthlyPrev: any = auditKind === 'monthly' ? await previousMonthlyReport(audit, prevSelect) : null;
        const prev: any = auditKind === 'monthly'
          ? (monthlyPrev?.auditData?.facts?.version >= 1 ? monthlyPrev : null)
          : await Audit.findOne({
            businessId: audit.businessId,
            status: 'COMPLETED',
            _id: { $ne: audit._id },
            'auditData.facts.version': { $gte: 1 },
          })
            .sort({ createdAt: -1 })
            .select(prevSelect)
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

    // Which rules made this report — a free report is reused only while they are current.
    auditData.logicVersion = REPORT_LOGIC_VERSION;

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
        { source: 'gbp_api', status: gbpLive ? 'read' : business.googleLocationId && !audit.fastMode ? 'read_failed' : 'not_connected', at: gbpLive ? (gbpIntel ? gbpIntel.sections.location.meta.lastSuccessfulFetchAt : nowIso) : null },
        { source: 'gbp_intelligence', status: gbpIntel ? 'snapshot_used' : business.googleLocationId && !audit.fastMode ? 'snapshot_not_fresh' : 'not_connected', at: gbpIntel ? gbpIntel.fetchedAt : null },
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
          { _id: audit.businessId, subscriptionStatus: { $nin: ['active', 'trial_active'] } },
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

      // Free account (unpaid workspace): "your free report is ready" push to
      // the app — its lock screens show the report card. Best-effort.
      if (audit.fastMode && !['active', 'trial_active'].includes(String(business.subscriptionStatus || ''))) {
        try {
          const { sendPushToBusinessUsers } = await import('@/services/push');
          await sendPushToBusinessUsers(String(audit.businessId), {
            title: 'Your free Google profile report is ready',
            body: `${business.name || 'Your business'} scored ${finalScore}/100. Tap to see what to fix first.`,
            data: { freeReport: '1' },
          });
        } catch (pushErr: any) {
          console.warn('[auditService] free report push failed:', pushErr?.message);
        }
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
          // SEO intelligence (full audits): stable tracked keywords, their measured
          // rows for content, focus services/areas, history — and whether this
          // audit's ranking data is complete enough to replace the plan's keywords.
          tracking: tracking
            ? {
                trackedKeywords: tracking.tracked,
                keywordChanges: tracking.keywordChanges,
                measurements: tracking.measurements,
                serviceVisibility: tracking.serviceVisibility,
                matrix: tracking.matrix,
                serviceAreas: [
                  ...(areaVisibility?.areas || []).filter((a) => a.status === 'measured' || a.status === 'covered_by_address').map((a) => a.area),
                ],
                history: strategyHistory,
              }
            : undefined,
          keywords: seoIntel?.keywordResearch
            ? {
                keywordSet: seoIntel.keywordResearch.keywordSet,
                changes: seoIntel.keywordResearch.changes,
                gaps: seoIntel.keywordResearch.gaps,
                research: {
                  ...seoIntel.keywordResearch.research,
                  ...(seoIntel.keywordResearch.freeReportComparison ? { freeReportComparison: seoIntel.keywordResearch.freeReportComparison } : {}),
                },
              }
            : undefined,
          rankingComplete: rankingFacts.overall.status === 'ok' || rankingFacts.overall.status === 'partial',
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
      // the report's own measured values; deferred to 09:00 IST at night.
      if (auditKind === 'monthly') {
        try {
          const { deliverMonthlyReportNotice } = require('../lifecycle/notify');
          await deliverMonthlyReportNotice(audit.businessId.toString(), audit._id.toString(), auditData);
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
function collectVerifiedServices(business: any, websiteSignals: any, gbpServices: string[] = []): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const v = String(s || '').trim();
    if (v.length >= 3 && v.length <= 60 && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  String(business.services || '').split(/[,;\n]+/).forEach(push);
  // Services Google lists on the connected profile (GBP Intelligence) are live-listed, i.e. verified.
  gbpServices.forEach(push);
  // NOT business.keywords: those are auto-filled from earlier audits'
  // keyword phrases ("it training institute kolkata"), not services.
  (websiteSignals?.servicePages || []).forEach(push);
  return out.slice(0, 20);
}

/** The like-for-like numbers two audits can be compared on. */
/**
 * What a MONTHLY report is compared with: the latest connected report (first
 * or monthly) of the most recent earlier calendar month (IST) — the same rule
 * as the keyword-ranking history (seo/measurements.ts monthlyHistoryAudits).
 * Support re-runs and audits from the current month are never the baseline.
 * The month is chosen first; when its latest report lacks the data a caller
 * needs, there is no baseline — an earlier same-month report is never used.
 */
export async function previousMonthlyReport(audit: any, select: string, now = new Date()): Promise<any | null> {
  const { monthlyHistoryAudits, RANK_HISTORY_FETCH, RANK_HISTORY_KINDS } = require('../seo/measurements');
  const rows: any[] = await Audit.find({
    businessId: audit.businessId, status: 'COMPLETED', fastMode: { $ne: true }, _id: { $ne: audit._id },
    auditKind: { $in: [...RANK_HISTORY_KINDS] },
  }).sort({ createdAt: -1 }).limit(RANK_HISTORY_FETCH).select(`createdAt ${select}`).lean();
  const [pick] = monthlyHistoryAudits(rows.map((row) => ({ at: new Date(row.createdAt).toISOString(), row })), now.toISOString(), 1);
  return pick?.row ?? null;
}

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
    completionBasis: data?.profileCompletion?.completionBasis ?? null,
    performance: data?.performanceBaseline?.status === 'verified'
      ? {
          days: 28,
          calls: data.performanceBaseline.calls,
          websiteClicks: data.performanceBaseline.websiteClicks,
          directionRequests: data.performanceBaseline.directionRequests,
        }
      : null,
    fr4Overall: data?.fr4?.auditScore?.overall ?? null,
    fr4ScoreVersion: data?.fr4?.auditScore?.version ?? null,
  };
}

/** A failed baseline / monthly audit gives its idempotency slot back so it can be retried. */
function releasePeriod(audit: any) {
  if (audit?.period) {
    audit.failedPeriod = audit.period;
    audit.period = undefined;
  }
}

/** Tracked searches plus the keyword stage's searches; a keyword searched by both keeps only the keyword stage's grid. */
function addressTrackedObs(tracked: SearchObservation[], keywordStage: SearchObservation[]): SearchObservation[] {
  const redone = new Set(keywordStage.map((o) => o.keyword.trim().toLowerCase()));
  return [...tracked.filter((o) => !redone.has(o.keyword.trim().toLowerCase())), ...keywordStage];
}
