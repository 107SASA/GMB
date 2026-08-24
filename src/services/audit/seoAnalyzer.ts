import type { IProfileCompletion, IChecklistItem, IDataQuality, IAuditConfidence, IBusinessIntelligence, IGeoGridKeyword, IKeywordRank } from '@/models/Audit';
import type { GeoGridPoint } from './geoGrid';
import { generateGeoGrid, GRID_SPACING_KM, GRID_AREA_SQ_KM } from './geoGrid';
import { fetchMapsLocalResultsBatch } from './dataForSeoClient';

// ── Profile Completion ─────────────────────────────────────────────────────────
//
// Status meanings:
//   Complete  – field is present and populated
//   Missing   – field was checkable and confirmed absent
//   Unknown   – we had no way to check (requires GBP OAuth access, or a
//               SerpApi resolution that hasn't happened yet)
//
// completionPercentage = Complete / (Complete + Missing), i.e. Unknown is
// excluded from the ratio entirely rather than scored as a half-failure —
// what we can't verify shouldn't move a "how complete is your profile"
// number in either direction. (Aug 2026: previously Unknown scored 0.5,
// which still penalized a free-report lead's score for fields we
// structurally never had a way to check pre-OAuth — same bug, sharper fix.)
// unknownCount is returned separately so the UI can say "N fields need
// verification" instead of silently folding them into the percentage.

export function calculateProfileCompletion(business: any) {
  const checklist: IChecklistItem[] = [];

  const add = (field: string, isComplete: boolean) =>
    checklist.push({ field, status: isComplete ? 'Complete' : 'Missing' });

  const addUnknown = (field: string, known: boolean | undefined, isComplete: boolean) => {
    if (known === undefined || known === null) {
      checklist.push({ field, status: 'Unknown' });
    } else {
      checklist.push({ field, status: isComplete ? 'Complete' : 'Missing' });
    }
  };

  // Real GBP Business Profile Management API access (OAuth) — set only by
  // the "Connect Google" flow (gbpConnect.ts / reportConnect.ts), never by
  // /free-report's Places autocomplete (that only sets googlePlaceId/
  // googleConnected, which just means "a listing was picked", not that we
  // have owner-authorized access to it). Without this, Additional Keywords/
  // Business Description/Services Listed/Social Links are genuinely
  // unknowable from any API we call — Places doesn't expose them — so an
  // empty value here means "never queryable", not "confirmed absent".
  // INTENTIONAL: this is why those four checklist items below use
  // addUnknown() instead of add() — do not "simplify" them back to add()
  // to make the percentage math look more familiar; that's the exact bug
  // this was fixed for (a free-report lead's profile completion penalized
  // for fields we structurally never had a way to check). See
  // PRODUCTION_READINESS / the free-report data-accuracy fix (Aug 2026).
  const hasGbpConnection = !!business.googleLocationId;
  const knownIf = (isKnown: boolean) => (isKnown ? true : undefined);

  // Fields we can definitively check from stored data
  add('Business Name',      !!business.name);
  add('Primary Category',   !!business.category || !!business.userDefinedCategory);
  addUnknown(
    'Additional Keywords',
    knownIf(hasGbpConnection || (!!business.keywords && business.keywords.length > 0)),
    !!business.keywords && business.keywords.length > 0,
  );
  addUnknown(
    'Business Description',
    knownIf(hasGbpConnection || (!!business.description && business.description.length > 0)),
    !!business.description && business.description.length > 50,
  );
  addUnknown(
    'Services Listed',
    knownIf(hasGbpConnection || (!!business.services && business.services.length > 0)),
    !!business.services && business.services.length > 0,
  );
  add('Address',            !!business.address);
  add('Phone',              !!business.phone);
  add('Website',            !!business.website);
  add('Service Area',       !!business.area);

  // Social links — use whichever social fields are actually stored
  const hasSocial = !!(
    business.facebookPageUrl ||
    business.instagramUrl ||
    business.metaBusinessProfileUrl
  );
  addUnknown('Social Links', knownIf(hasGbpConnection || hasSocial), hasSocial);

  // These two are populated from the SerpApi place-details response during data_id
  // resolution. If they've never been resolved, status is Unknown (benefit of the doubt).
  addUnknown('Business Photos',  business.photoCount, (business.photoCount ?? 0) > 0);
  addUnknown('Business Hours',   business.hasHours,    !!business.hasHours);

  // These require GBP Management API (OAuth) – we cannot verify them, mark Unknown
  const gbpOnly = ['Videos', 'Logo / Cover Image', 'Attributes', 'Booking / Appointment Link'];
  for (const f of gbpOnly) {
    checklist.push({ field: f, status: 'Unknown' });
  }

  const completeCount = checklist.filter((c) => c.status === 'Complete').length;
  const missingCount  = checklist.filter((c) => c.status === 'Missing').length;
  const unknownCount  = checklist.filter((c) => c.status === 'Unknown').length;

  // Guarded against 0 even though Business Name/Category/Address/Phone/
  // Website/Service Area are always checkable (never Unknown), so
  // completeCount+missingCount is never actually 0 in practice.
  const checkableTotal = Math.max(1, completeCount + missingCount);
  const completionPercentage = Math.round((completeCount / checkableTotal) * 100);

  return {
    data: { completionPercentage, checklist, missingCount, unknownCount },
    evidenceSource: hasGbpConnection
      ? 'Calculated from connected GBP data. Fields marked Unknown require GBP Management API access we don\'t have even when connected (Videos, Logo/Cover, Attributes, Booking Link).'
      : 'Calculated from Google Places + intake data — this business is not yet connected via GBP OAuth, so keywords/description/services/social links marked Unknown could not be checked (Places API doesn\'t expose them), not confirmed absent. Percentage reflects only confirmed-complete vs confirmed-missing fields; Unknown fields are excluded, not penalized.'
  };
}

// ── Review Metrics ─────────────────────────────────────────────────────────────

export function calculateReviewMetrics(
  reviews: any[],
  placesSnapshot?: { rating?: number; reviewCount?: number },
) {
  if (!reviews || reviews.length === 0) {
    // No synced Review documents (fastMode skips that sync, or it just
    // hasn't run yet) — but if we have a rating/count read live from Google
    // Places at intake, that's real data, not a "0 reviews" finding. Only
    // total count + average rating are knowable from Places; reviews/week,
    // response rate, and sentiment split need per-review detail Places
    // doesn't expose, so those stay at honest zero-defaults and are listed
    // in estimatedFields so the caller/UI can grey them out instead of
    // showing "0%" next to a real, nonzero review count as if it were a
    // genuine finding.
    const hasSnapshot =
      !!placesSnapshot &&
      typeof placesSnapshot.reviewCount === 'number' &&
      placesSnapshot.reviewCount > 0 &&
      placesSnapshot.rating != null;

    if (hasSnapshot) {
      return {
        data: {
          reviewCount: placesSnapshot!.reviewCount!,
          averageRating: placesSnapshot!.rating!,
          reviewsPerWeek: 0,
          responseRate: '0%',
          industryAverage: 4.2,
          positivePercent: 0,
          neutralPercent: 0,
          negativePercent: 0,
          estimatedFields: ['reviewsPerWeek', 'responseRate', 'positivePercent', 'neutralPercent', 'negativePercent'],
        },
        evidenceSource:
          'Review count & average rating captured live from Google Places at report intake — reviews-per-week, response rate, and sentiment split require a synced review, not yet performed for this report.',
      };
    }

    return {
      data: {
        reviewCount: 0,
        averageRating: 0,
        reviewsPerWeek: 0,
        responseRate: '0%',
        industryAverage: 4.2,
        positivePercent: 0,
        neutralPercent: 0,
        negativePercent: 0,
      },
      evidenceSource: 'No reviews found on Google Business Profile'
    };
  }

  const reviewCount = reviews.length;
  const sumRating = reviews.reduce((acc, r) => acc + (r.rating || 0), 0);
  const averageRating = parseFloat((sumRating / reviewCount).toFixed(1));

  let reviewsPerWeek = 0;
  if (reviewCount > 1) {
    const sorted = [...reviews].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const oldest = new Date(sorted[0].date);
    const newest = new Date(sorted[sorted.length - 1].date);
    const weeksDiff = Math.max(1, (newest.getTime() - oldest.getTime()) / (1000 * 60 * 60 * 24 * 7));
    reviewsPerWeek = parseFloat((reviewCount / weeksDiff).toFixed(1));
  } else {
    reviewsPerWeek = 0.5;
  }

  const respondedCount = reviews.filter(r => r.ownerReply).length;
  const responseRate = Math.round((respondedCount / reviewCount) * 100) + '%';

  // Sentiment breakdown from real Review documents (field added in auditService)
  const positiveCount = reviews.filter(r => r.sentiment === 'positive').length;
  const negativeCount = reviews.filter(r => r.sentiment === 'negative' || r.sentiment === 'critical').length;
  const neutralCount  = reviewCount - positiveCount - negativeCount;

  const pct = (n: number) => Math.round((n / reviewCount) * 100);

  return {
    data: {
      reviewCount,
      averageRating,
      reviewsPerWeek,
      responseRate,
      industryAverage: 4.2,
      positivePercent: pct(positiveCount),
      neutralPercent:  pct(neutralCount),
      negativePercent: pct(negativeCount),
    },
    evidenceSource: `Aggregated from ${reviewCount} live Google Reviews via SerpApi`
  };
}

// ── Review Quality Score (0-100) ───────────────────────────────────────────────
// Combines avg rating (60%) and sentiment distribution (40%).
// Used as one pillar of the final audit score.

export function calculateReviewQualityScore(reviews: any[]): number {
  if (!reviews || reviews.length === 0) return 0;

  const avgRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length;
  const ratingScore = (avgRating / 5) * 60; // 0–60

  const positive = reviews.filter(r => r.sentiment === 'positive').length;
  const negative = reviews.filter(r => r.sentiment === 'negative' || r.sentiment === 'critical').length;
  // sentimentRatio: –1 (all negative) → +1 (all positive)
  const sentimentRatio = (positive - negative) / reviews.length;
  const sentimentScore = ((sentimentRatio + 1) / 2) * 40; // 0–40

  return Math.round(Math.min(100, ratingScore + sentimentScore));
}

// ── Review Keyword Analysis ────────────────────────────────────────────────────
// Mines real review text for category/service keyword presence.
// Returns coverage score (0-100) and top mentioned / missing keywords.

export function analyzeReviewKeywords(reviews: any[], business: any): {
  mentionedKeywords: Array<{ keyword: string; count: number; density: number }>;
  missingKeywords: string[];
  keywordScore: number;
  evidenceSource: string;
} {
  // Build target keyword list from stored business data
  const rawKeywords: string[] = [
    ...(Array.isArray(business.keywords) ? business.keywords : []),
    ...(business.services
      ? String(business.services).split(/[,;]+/).map((s: string) => s.trim())
      : []),
    ...(business.userDefinedCategory ? [business.userDefinedCategory] : []),
    ...(business.category ? [business.category] : []),
  ];

  const targetKeywords = [...new Set(
    rawKeywords.map(k => k.toLowerCase().trim()).filter(k => k.length > 2)
  )];

  const corpus = reviews.map(r => (r.text || '').toLowerCase()).join(' ');
  const totalWords = corpus.split(/\s+/).filter(w => w.length > 0).length;

  if (!corpus.trim() || targetKeywords.length === 0) {
    return {
      mentionedKeywords: [],
      missingKeywords: targetKeywords.slice(0, 5),
      keywordScore: 0,
      evidenceSource: reviews.length === 0
        ? 'No reviews available for keyword analysis'
        : 'No target keywords configured (add business category/services/keywords)'
    };
  }

  const mentioned: Array<{ keyword: string; count: number; density: number }> = [];
  const missing: string[] = [];

  for (const kw of targetKeywords) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const count = (corpus.match(new RegExp(escaped, 'g')) || []).length;
    if (count > 0) {
      mentioned.push({
        keyword: kw,
        count,
        density: parseFloat(((count / Math.max(1, totalWords)) * 100).toFixed(2)),
      });
    } else {
      missing.push(kw);
    }
  }

  mentioned.sort((a, b) => b.count - a.count);
  const keywordScore = Math.round((mentioned.length / targetKeywords.length) * 100);

  return {
    mentionedKeywords: mentioned.slice(0, 10),
    missingKeywords:   missing.slice(0, 5),
    keywordScore,
    evidenceSource: `Mined ${reviews.length} reviews (${totalWords} words) for ${targetKeywords.length} target keywords`
  };
}

// ── Retry helper ────────────────────────────────────────────────────────────────

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      // DataForSeoApiError.category is the primary signal now (set for
      // every DataForSEO failure — see dataForSeoClient.ts); the raw HTTP
      // status fallback covers errors from anything else calling through
      // retryWithBackoff. An 'account' error (bad/unverified credentials)
      // is never retryable — retrying won't fix a verification gate.
      const category: string | undefined = err?.category;
      const status: number | undefined = err?.response?.status;
      const retryable = category
        ? category === 'rate_limit' || category === 'server'
        : status === 429 || (status != null && status >= 500);
      if (!retryable || attempt === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, (2 ** attempt) * 1000));
    }
  }
  throw new Error('unreachable');
}

// ── Geo-grid keyword ranking via DataForSEO ─────────────────────────────────────
// Checks rank from 9 points in a 3×3 grid (1.5 km spacing) around the business.
// Harvests local-pack competitors from the same 45 responses at no extra cost.
//
// NOT_FOUND_RANK (21) is a sentinel meaning "not in the Google local pack
// (typically top ~20)". It is NOT a real Maps position — UI/PDF must render it
// as "20+".

export const NOT_FOUND_RANK = 21;

// Google Places' own category resolution falls back to bucket words this
// generic for a lot of real businesses (see deriveCategory/GENERIC_PLACE_TYPES
// in src/services/google/places.ts, and the "Local Business" default in
// shadowAccount.ts) — searching on one of these alone returns essentially
// any local business ("services in Kolkata" surfaces ambulance/cleaning/
// catering/massage services with equal weight), which is what was polluting
// the free-report competitor list even after the local-pack relevance filter
// (that filter has nothing useful to filter against when the query itself
// was this broad — confirmed against live data for Desun Technology, Aug
// 2026: category="Services" → keyword "services kolkata" → empty DataForSEO
// local-pack, and Places textsearch competitors were ambulance/cleaning/
// massage/catering services, none sharing any real category with the
// audited business).
const GENERIC_CATEGORY_VALUES = new Set([
  'services', 'service', 'local business', 'business', 'establishment',
  'point of interest', 'general', 'company', 'other', 'point_of_interest',
]);

// Common trailing words in Indian SMB names ("X Solutions", "X Enterprises")
// that are themselves too generic to search on alone — when the name's last
// word is one of these, the word before it is included too, for one more
// word of context (e.g. "Tech Solutions" rather than bare "Solutions").
const WEAK_TRAILING_WORDS = new Set(['solutions', 'enterprises', 'group', 'industries', 'services', 'ventures']);

// Left dangling after stripping a location mention out of the name (e.g.
// "...Institute in Kolkata" → strip "Kolkata" → "...Institute in" — this
// still needs the trailing "in" dropped too). Also filters bare 1-2 letter
// junk tokens that survive punctuation stripping.
const TRAILING_FILLER_WORDS = new Set(['in', 'at', 'near', 'on', 'of', 'for', 'the']);

/**
 * A stored `category` this generic isn't worth searching on alone — falls
 * back to a keyword derived from the business's own NAME instead (stripped
 * of legal suffixes), since Google's Places type taxonomy has no more
 * specific signal to offer here (verified: Desun's own Places `types` and a
 * genuinely unrelated competitor's `types` were IDENTICAL — `types` can't
 * discriminate this case, only the name can).
 *
 * HEURISTIC, not real NLP: assumes the common "{Brand} {Category word}
 * {Legal suffix}" naming pattern (e.g. "Desun Technology Private Limited" →
 * "Technology", "Peacock Salon" → "Salon") and takes the last 1-2
 * significant words. Won't be right for every business name, but is a
 * meaningfully better search term than a bucket word matching every local
 * business in the city.
 *
 * `location` (city/area/state) is stripped from the name FIRST — confirmed
 * live (Aug 2026) that without this, a name like "Desun Academy - Top IT
 * Training Institute in Kolkata" derives "Kolkata" as its keyword (the
 * name's actual last word), producing a search query ("Kolkata company")
 * with zero topical signal — it matches literally any company in the city,
 * which is exactly what was showing up as "competitors." Extremely common
 * failure shape: Indian SMB listings routinely end their GBP title with
 * "... in {City}".
 */
export function resolveSearchCategory(
  category: string | undefined,
  businessName: string | undefined,
  location?: Array<string | undefined>,
): string {
  const cat = (category || '').trim();
  if (cat && !GENERIC_CATEGORY_VALUES.has(cat.toLowerCase())) return cat;

  let cleanedName = (businessName || '')
    .replace(/\b(pvt\.?|private|ltd\.?|limited|llp|inc\.?|llc|co\.?|company|plc|corp\.?|corporation)\b/gi, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const loc of location || []) {
    const trimmed = (loc || '').trim();
    if (!trimmed) continue;
    cleanedName = cleanedName.replace(new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'gi'), ' ');
  }
  cleanedName = cleanedName.replace(/\s+/g, ' ').trim();

  let words = cleanedName.split(' ').filter(Boolean);
  while (words.length > 1 && TRAILING_FILLER_WORDS.has(words[words.length - 1].toLowerCase())) {
    words = words.slice(0, -1);
  }
  if (words.length === 0) return cat || 'business';

  const last = words[words.length - 1];
  const nameKeyword = words.length >= 2 && WEAK_TRAILING_WORDS.has(last.toLowerCase())
    ? words.slice(-2).join(' ')
    : last;
  if (!nameKeyword) return cat || 'business';

  // "Company" qualifier: verified against live Google Places data (Aug
  // 2026) — a bare word like "Technology" alone reads to Places' textsearch
  // as matching literal institution names ("Institute of Technology",
  // "University of Technology"), surfacing colleges instead of businesses.
  // Appending a business qualifier disambiguates it: "technology company
  // kolkata" correctly surfaced real IT/software businesses (including the
  // exact competitor a rival product's own report found for this same
  // business), where "technology kolkata" alone surfaced only colleges.
  // Applied unconditionally to this name-derived fallback (not to a real
  // stored category) — for an already business-shaped word ("Salon"), the
  // extra qualifier is at worst a redundant-sounding query, not a wrong
  // one; textsearch is token-based, not strict-phrase, so it doesn't break
  // an otherwise-good match.
  return `${nameKeyword} company`;
}

function buildKeywords(business: any): string[] {
  const effectiveCategory = resolveSearchCategory(
    business.category,
    business.name || business.businessName,
    [business.city, business.area, business.state],
  );
  const categoryLower = effectiveCategory.toLowerCase();
  const cityLower = (business.city || '').toLowerCase();

  let seedWords: string[] = [];
  if (business.keywords && business.keywords.length > 0) {
    seedWords = business.keywords.map((k: string) => String(k).trim()).filter(Boolean);
  } else if (business.services && business.services.length > 0) {
    seedWords = String(business.services).split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean);
  } else {
    seedWords = [categoryLower];
  }

  const primary = seedWords[0] || categoryLower;
  const secondary = seedWords[1];

  return [
    cityLower ? `${primary} ${cityLower}` : primary,
    cityLower ? `best ${primary} ${cityLower}` : `best ${primary}`,
    cityLower ? `top ${primary} ${cityLower}` : `top ${primary}`,
    `${primary} near me`,
    secondary
      ? (cityLower ? `${secondary} ${cityLower}` : secondary)
      : (cityLower ? `${cityLower} ${categoryLower}` : categoryLower),
  ].map(k => k.trim()).filter(Boolean);
}

/** Normalize names for fuzzy matching (strip legal suffixes / punctuation).
 *  Exported so auditService.ts can reuse the same matching semantics to
 *  filter Places-sourced competitors against the local-pack harvest below. */
export function normalizeBusinessName(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(pvt|private|ltd|limited|llp|inc|llc|co|company|plc|corp|corporation)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectPlaceIds(business: any): string[] {
  const ids = [
    business.placeId,
    business.googlePlaceId,
    business.serpApiDataId,
    business.dataId,
  ]
    .filter(Boolean)
    .map((id: string) => String(id).trim())
    .filter(Boolean);
  // Also accept "places/ChIJ..." style ids
  return Array.from(new Set(ids.flatMap((id) => {
    const bare = id.replace(/^places\//, '');
    return bare === id ? [id] : [id, bare];
  })));
}

export function namesLikelyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Token overlap (handles "Joe's Pizza Downtown" vs "Joes Pizza")
  const ta = new Set(a.split(' ').filter((t) => t.length > 2));
  const tb = new Set(b.split(' ').filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return false;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  const minSize = Math.min(ta.size, tb.size);
  return overlap >= Math.max(1, Math.ceil(minSize * 0.7));
}

function findTargetRank(localResults: any[], business: any): number {
  if (!localResults?.length) return NOT_FOUND_RANK;

  const placeIds = collectPlaceIds(business);
  let idx = -1;

  if (placeIds.length) {
    idx = localResults.findIndex((r: any) => {
      const candidates = [r.place_id, r.data_id, r.placeId]
        .filter(Boolean)
        .map((id: string) => String(id).replace(/^places\//, ''));
      return candidates.some((id) => placeIds.includes(id) || placeIds.includes(`places/${id}`));
    });
  }

  if (idx === -1) {
    const target = normalizeBusinessName(business.name || business.businessName || '');
    if (target) {
      idx = localResults.findIndex((r: any) =>
        namesLikelyMatch(normalizeBusinessName(r.title || r.name || ''), target),
      );
    }
  }

  // Last resort: GPS proximity (< ~80m) when coordinates are available on both sides
  if (idx === -1 && business.coordinates?.lat != null && business.coordinates?.lng != null) {
    const tLat = Number(business.coordinates.lat);
    const tLng = Number(business.coordinates.lng);
    idx = localResults.findIndex((r: any) => {
      const g = r.gps_coordinates || r.gpsCoordinates;
      if (g?.latitude == null || g?.longitude == null) return false;
      const dLat = Math.abs(Number(g.latitude) - tLat);
      const dLng = Math.abs(Number(g.longitude) - tLng);
      return dLat < 0.0008 && dLng < 0.0008; // ~80–90m
    });
  }

  return idx === -1 ? NOT_FOUND_RANK : idx + 1;
}

function isOwnBusiness(resultName: string, business: any): boolean {
  const target = normalizeBusinessName(business.name || business.businessName || '');
  const other = normalizeBusinessName(resultName);
  if (!target || !other) return false;
  return namesLikelyMatch(target, other);
}

/** Center + immediate east/south neighbors from the full 3×3 grid, instead
 *  of all 9 points — real Maps data at 3 points instead of 9, used for
 *  fastMode's "reduced" rank check so it costs ~3 DataForSEO calls (with 1
 *  keyword) instead of 45, rather than skipping ranking entirely. Looked up
 *  by row/col rather than assumed array position, since generateGeoGrid's
 *  ordering is an implementation detail this function shouldn't depend on. */
function reducedGridPoints(fullGrid: GeoGridPoint[]): GeoGridPoint[] {
  const center = fullGrid.find(p => p.row === 0 && p.col === 0);
  const east   = fullGrid.find(p => p.row === 0 && p.col === 1);
  const south  = fullGrid.find(p => p.row === 1 && p.col === 0);
  return [center, east, south].filter(Boolean) as GeoGridPoint[];
}

export async function fetchGeoGridRankings(
  business: any,
  options: { reduced?: boolean } = {},
): Promise<{
  geoGridRank: {
    keywords: IGeoGridKeyword[];
    overallAvgRank: number;
    gridSpacingKm: number;
    areaSqKm: number;
    visibilityPct?: number;
    /** 'reduced' = fastMode's cheaper check (1 keyword × ≤3 points) — real
     *  data, just a smaller sample. UI should badge this "Quick check"
     *  rather than hide the number, per the no-fabrication rule below. */
    gridResolution: 'full' | 'reduced';
  } | null;
  localPackCompetitors: Array<{
    name: string;
    avgRank: number;
    rating?: number;
    reviewCount?: number;
    placeId?: string;
  }>;
  legacyRankings: IKeywordRank[];
  evidenceSource: string;
  /** Set when the DataForSEO call itself failed (account/rate-limit/server/
   *  unknown) rather than genuinely finding nothing — see
   *  DataForSeoApiError in dataForSeoClient.ts. Distinct from a null/absent
   *  value, which means "not attempted" (e.g. not configured). Consumers
   *  should NOT cache a result with fetchError set as if it were a real
   *  "not found" answer. */
  fetchError?: { category: string; message: string } | null;
}> {
  const gridResolution: 'full' | 'reduced' = options.reduced ? 'reduced' : 'full';
  // Reduced mode checks only the single highest-priority keyword (primary
  // category + city, buildKeywords()'s first entry) — real rank for a real
  // keyword, just one instead of five, to keep the query budget small.
  const allKeywords = buildKeywords(business);
  const keywords = options.reduced ? allKeywords.slice(0, 1) : allKeywords;

  // ── No coordinates → single-point fallback ───────────────────────────────────
  if (!business.coordinates?.lat || !business.coordinates?.lng) {
    let fetchError: { category: string; message: string } | null = null;
    let rawResults: any[][];
    try {
      rawResults = await fetchMapsLocalResultsBatch(keywords.map(keyword => ({ keyword, business })));
    } catch (err: any) {
      fetchError = { category: err?.category || 'unknown', message: err?.message || String(err) };
      console.error(`[seoAnalyzer] DataForSEO Maps call failed (${fetchError.category}): ${fetchError.message}`);
      rawResults = keywords.map(() => []);
    }

    const legacyRankings: IKeywordRank[] = keywords.map((keyword, idx) => {
      const localResults = rawResults[idx] || [];
      const rank = findTargetRank(localResults, business);
      return { keyword, rank, sourceQuery: keyword, confidence: rank < NOT_FOUND_RANK ? 'High' : 'Low' };
    });

    // Harvest competitors with their REAL local-pack positions (not the 21 sentinel)
    const competitorMap = new Map<string, {
      name: string; ranks: number[]; rating?: number; reviewCount?: number; placeId?: string;
    }>();
    for (const localResults of rawResults) {
      localResults.slice(0, 10).forEach((r: any, i: number) => {
        if (!r.title) return;
        if (isOwnBusiness(r.title, business)) return;
        const key = (r.place_id || r.data_id || r.title).toString().toLowerCase().trim();
        const existing = competitorMap.get(key);
        if (existing) {
          existing.ranks.push(i + 1);
        } else {
          competitorMap.set(key, {
            name: r.title,
            ranks: [i + 1],
            rating: r.rating,
            reviewCount: r.reviews,
            placeId: r.place_id || r.data_id,
          });
        }
      });
    }
    const localPackCompetitors = Array.from(competitorMap.values())
      .map(c => ({
        name: c.name,
        avgRank: parseFloat((c.ranks.reduce((a, b) => a + b, 0) / c.ranks.length).toFixed(1)),
        rating: c.rating,
        reviewCount: c.reviewCount,
        placeId: c.placeId,
      }))
      .sort((a, b) => a.avgRank - b.avgRank)
      // Raised from 5 → 10: the free-report leaderboard table now shows a
      // fuller list (matching Grexa's longer competitor list) — this is
      // free, since it's just keeping more of the already-fetched/
      // aggregated results, not an extra API call.
      .slice(0, 10);

    const overallAvgRank = parseFloat(
      (legacyRankings.reduce((sum, k) => sum + k.rank, 0) / Math.max(1, legacyRankings.length)).toFixed(1),
    );
    const foundCount = legacyRankings.filter(k => k.rank < NOT_FOUND_RANK).length;

    return {
      // Synthetic keyword grid so the report can always render keyword + competitor tables
      geoGridRank: {
        keywords: legacyRankings.map(k => ({
          keyword: k.keyword,
          avgRank: k.rank,
          points: [] as Array<{ lat: number; lng: number; rank: number }>,
        })),
        overallAvgRank,
        gridSpacingKm: 0,
        areaSqKm: 0,
        visibilityPct: Math.round((foundCount / Math.max(1, legacyRankings.length)) * 100),
        gridResolution,
      },
      localPackCompetitors,
      legacyRankings,
      evidenceSource: fetchError
        ? `DataForSEO request failed (${fetchError.category}): ${fetchError.message}`
        : `${gridResolution === 'reduced' ? 'Quick check — single' : 'Single'}-point SERP data (no coordinates): ${keywords.slice(0, 3).join(', ')}`,
      fetchError,
    };
  }

  // ── 3×3 geo-grid: 5 keywords × 9 points = 45 DataForSEO Maps calls
  // (reduced: 1 keyword × 3 points = 3 calls) ─────────────────────────────
  const fullGridPoints: GeoGridPoint[] = generateGeoGrid(
    business.coordinates.lat,
    business.coordinates.lng,
    GRID_SPACING_KM,
  );
  const gridPoints = options.reduced ? reducedGridPoints(fullGridPoints) : fullGridPoints;

  type TaskResult = {
    keyword: string;
    point: GeoGridPoint;
    rank: number;
    competitors: Array<{ name: string; rank: number; rating?: number; reviewCount?: number; placeId?: string }>;
  };

  const queries = keywords.flatMap(keyword => gridPoints.map(point => ({ keyword, point })));

  // All 45 keyword/point combinations go out in a single DataForSEO request
  // (their Live endpoint accepts a batch of tasks and processes them
  // server-side) instead of 45 individually-throttled client calls — this is
  // what previously made geo-grid the slowest part of generating an audit.
  let fetchError: { category: string; message: string } | null = null;
  let batchResults: any[][];
  try {
    batchResults = await retryWithBackoff(() =>
      fetchMapsLocalResultsBatch(queries.map(q => ({ ...q, business }))),
    );
  } catch (err: any) {
    fetchError = { category: err?.category || 'unknown', message: err?.message || String(err) };
    console.error(`[seoAnalyzer] DataForSEO Maps call failed (${fetchError.category}): ${fetchError.message}`);
    batchResults = queries.map(() => []);
  }

  const allResults: TaskResult[] = queries.map(({ keyword, point }, i) => {
    const localResults = batchResults[i] || [];
    const rank = findTargetRank(localResults, business);
    const rankIdx = rank - 1; // 0-based index of target, or -1 if not found

    // Collect results ranked above the target (or top 10 when target not
    // found at this specific point — raised from 5, Aug 2026: with 2 of 3
    // reduced-grid points often landing "not found," the old cap of 5 could
    // leave the competitor table showing only a handful of real names next
    // to a rank number (an average across points, including the not-found
    // ones) that implied many more businesses ahead — a real data-
    // completeness gap, not a fabrication; this doesn't invent anything,
    // just keeps more of what the same already-paid-for query returned).
    const aboveCount = rank === NOT_FOUND_RANK
      ? Math.min(10, localResults.length)
      : rankIdx;

    const competitors = localResults.slice(0, aboveCount)
      .map((r: any, i: number) => ({
        name: (r.title || '') as string,
        rank: i + 1,
        rating: r.rating as number | undefined,
        reviewCount: r.reviews as number | undefined,
        placeId: (r.place_id || r.data_id) as string | undefined,
      }))
      .filter(c => c.name && !isOwnBusiness(c.name, business));

    return { keyword, point, rank, competitors };
  });

  // ── Aggregate competitors: dedupe by placeId or name, average their ranks ───
  const competitorMap = new Map<string, {
    name: string; ranks: number[]; rating?: number; reviewCount?: number; placeId?: string;
  }>();

  for (const { competitors } of allResults) {
    for (const c of competitors) {
      if (!c.name) continue;
      const key = c.placeId || c.name.toLowerCase().trim();
      const existing = competitorMap.get(key);
      if (existing) {
        existing.ranks.push(c.rank);
      } else {
        competitorMap.set(key, { name: c.name, ranks: [c.rank], rating: c.rating, reviewCount: c.reviewCount, placeId: c.placeId });
      }
    }
  }

  const localPackCompetitors = Array.from(competitorMap.values())
    .map(c => ({
      name: c.name,
      avgRank: parseFloat((c.ranks.reduce((a, b) => a + b, 0) / c.ranks.length).toFixed(1)),
      rating: c.rating,
      reviewCount: c.reviewCount,
      placeId: c.placeId,
    }))
    .sort((a, b) => a.avgRank - b.avgRank)
    // Raised from 5 → 10 — see the matching comment in the no-coordinates
    // branch above.
    .slice(0, 10);

  // ── Aggregate per keyword: average rank across its 9 grid points ─────────────
  const geoGridKeywords: IGeoGridKeyword[] = keywords.map(keyword => {
    const kResults = allResults.filter(r => r.keyword === keyword);
    const points = kResults.map(r => ({ lat: r.point.lat, lng: r.point.lng, rank: r.rank }));
    const avgRank = parseFloat(
      (points.reduce((sum, p) => sum + p.rank, 0) / Math.max(1, points.length)).toFixed(1),
    );
    return { keyword, avgRank, points };
  });

  const overallAvgRank = parseFloat(
    (geoGridKeywords.reduce((sum, k) => sum + k.avgRank, 0) / Math.max(1, geoGridKeywords.length)).toFixed(1),
  );

  const allPointRanks = geoGridKeywords.flatMap(k => k.points.map(p => p.rank));
  const visibilityPct = Math.round(
    (allPointRanks.filter(r => r < NOT_FOUND_RANK).length / Math.max(1, allPointRanks.length)) * 100,
  );

  // Legacy shape — keeps googleSearchRank working in the existing scoring / UI
  const legacyRankings: IKeywordRank[] = geoGridKeywords.map(k => ({
    keyword: k.keyword,
    rank: k.avgRank,
    sourceQuery: k.keyword,
    confidence: k.avgRank < NOT_FOUND_RANK ? 'High' : 'Low',
  }));

  return {
    geoGridRank: {
      keywords: geoGridKeywords,
      overallAvgRank,
      gridSpacingKm: GRID_SPACING_KM,
      // A reduced grid (center + 2 neighbors) isn't a clean square, so the
      // "sq km" figure doesn't mean anything for it — 0 rather than the
      // full-grid constant, so the UI doesn't report a fabricated area.
      // gridResolution is what the UI should actually key off of.
      areaSqKm: options.reduced ? 0 : GRID_AREA_SQ_KM,
      visibilityPct,
      gridResolution,
    },
    localPackCompetitors,
    legacyRankings,
    evidenceSource: fetchError
      ? `DataForSEO request failed (${fetchError.category}): ${fetchError.message}`
      : options.reduced
        ? `Quick check — ${gridPoints.length}-point sample, ${GRID_SPACING_KM} km spacing ` +
          `around [${business.coordinates.lat}, ${business.coordinates.lng}] | ` +
          `keyword: ${keywords[0]} | visibility ${visibilityPct}%`
        : `Geo-grid SERP: 3×3, ${GRID_SPACING_KM} km spacing, ${GRID_AREA_SQ_KM} sq km ` +
          `around [${business.coordinates.lat}, ${business.coordinates.lng}] | ` +
          `keywords: ${keywords.slice(0, 3).join(', ')} | visibility ${visibilityPct}%`,
    fetchError,
  };
}

// ── V7 Native Analyzers ────────────────────────────────────────────────────────

// Terms Google's Business Profile naming guidelines discourage in a listing
// title (promotional/superlative language) — checked as whole words so
// "top" doesn't false-positive inside "laptop", "desktop", etc.
const SELF_PRAISE_TERMS = [
  'best', 'top', 'no.1', 'no1', 'number 1', '#1', 'leading', 'premier',
  'finest', 'trusted', 'award-winning', 'award winning',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSelfPraiseTerm(nameLower: string): string | undefined {
  return SELF_PRAISE_TERMS.find((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(nameLower));
}

/**
 * Native (no AI call) title-level SEO checks — the same kind of forensic,
 * deterministic findings a rival product's free report leads with (word
 * count, self-praise language, primary keyword placement). All computed
 * directly from the stored business name/category, nothing invented.
 *
 * Deliberately does NOT attempt a "category not in top N by keyword search
 * volume" check — that needs real keyword-volume data (Keyword Planner/
 * DataForSEO volume endpoints) this codebase has no integration for. Faking
 * that specific a claim without the data behind it would be the same kind
 * of overclaiming the Unknown-vs-Missing checklist distinction exists to
 * avoid elsewhere in this file — so it's just not included until there's a
 * real data source for it.
 */
export function analyzeTitleSeo(business: any): string[] {
  const name = String(business.name || business.businessName || '').trim();
  if (!name) return [];

  const issues: string[] = [];
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 8) {
    issues.push(`Title has ${words.length} words — Google Business Profile titles read best under 8 words`);
  }

  const nameLower = name.toLowerCase();
  const praiseTerm = findSelfPraiseTerm(nameLower);
  if (praiseTerm) {
    issues.push(`Title contains a self-praise keyword ("${praiseTerm}") — against Google's Business Profile naming guidelines`);
  }

  // The same name-derived keyword root buildKeywords() uses for rank
  // tracking, so "primary keyword" here means the literal term the report
  // is checking rank against, not a separately invented one.
  const primaryKeyword = resolveSearchCategory(business.category, name, [business.city, business.area, business.state])
    .replace(/\s+company$/i, '')
    .trim();
  if (primaryKeyword && primaryKeyword.toLowerCase() !== 'business' && !nameLower.includes(primaryKeyword.toLowerCase())) {
    issues.push(`Primary keyword "${primaryKeyword}" not found in your business title`);
  }

  return issues;
}

export function calculateNativeSeoScore(business: any, profileCompletion: IProfileCompletion) {
  let score = 0;
  const opps: string[] = [];

  const add = (condition: boolean, weight: number, opp: string) => {
    if (condition) score += weight;
    else opps.push(opp);
  };

  // Title Present was a real gap: word-count/self-praise/keyword-in-title
  // checks (analyzeTitleSeo, below) were always unweighted findings, but a
  // completely missing business name earned/lost nothing either — a blank
  // title could still score 100. Weights rebalanced (still sum to 100) to
  // make room for it rather than just bolting 15 more points onto the top.
  const name = String(business.name || business.businessName || '').trim();
  add(!!name,                                                        15, 'Add a Business Name/Title — this is required for any SEO visibility');
  add(!!business.description && business.description.length > 100, 20, 'Expand Business Description to 100+ characters');
  add(!!business.category || !!business.userDefinedCategory,        15, 'Set a Primary Category');
  add(!!business.keywords && business.keywords.length > 0,          15, 'Add Keywords / Additional Categories');
  add(!!business.services && business.services.length > 0,          10, 'Populate Service Catalog');
  add(!!business.website,                                            15, 'Link a Website for local authority');
  add(profileCompletion.completionPercentage >= 80,                  10, 'Improve overall Profile Completion to >80%');

  // Word-count/self-praise/keyword-in-title checks stay unweighted findings
  // (title *presence* is scored above; title *quality* is advisory, same as
  // before) — analyzeTitleSeo() already no-ops when name is empty, so this
  // never double-reports the missing-title case handled by add() above.
  opps.push(...analyzeTitleSeo(business));

  return {
    score,
    missingKeywords: opps.filter(o => o.includes('Category') || o.includes('Keyword')),
    optimizationOpportunities: opps,
  };
}

export function calculateAuditConfidence(
  profileCompletion: number,
  competitorCount: number,
  reviewCount: number,
  hasWebsite: boolean
): IAuditConfidence {
  let score = 0;
  const dataQuality: IDataQuality = {
    profileData:          profileCompletion > 50 ? 'Complete' : profileCompletion > 0 ? 'Partial' : 'Unavailable',
    competitorDiscovery:  competitorCount >= 5   ? 'Complete' : competitorCount > 0    ? 'Partial' : 'Unavailable',
    keywordDiscovery:     'Complete',
    reviewAnalysis:       reviewCount > 0        ? 'Complete' : 'Unavailable',
    websiteAnalysis:      hasWebsite             ? 'Complete' : 'Unavailable',
  };

  if (dataQuality.profileData === 'Complete')         score += 25;
  else if (dataQuality.profileData === 'Partial')     score += 12;
  if (dataQuality.competitorDiscovery === 'Complete') score += 25;
  else if (dataQuality.competitorDiscovery === 'Partial') score += 15;
  if (dataQuality.keywordDiscovery === 'Complete')    score += 20;
  if (dataQuality.reviewAnalysis === 'Complete')      score += 20;
  if (dataQuality.websiteAnalysis === 'Complete')     score += 10;

  return { dataQuality, confidenceScore: score };
}

export function generateNativePriorityFixes(
  business: any,
  profileCompletion: IProfileCompletion,
  reviewCount: number,
  competitors: any[]
) {
  const fixes: any[] = [];
  const add = (condition: boolean, title: string, reason: string) => {
    if (!condition) fixes.push({ title, reason });
  };

  // Description/Services are only flagged when the checklist has confirmed
  // them Missing — NOT when they're merely Unknown (pre-OAuth, structurally
  // unverifiable — see calculateProfileCompletion). Recommending "Add
  // Business Description" for a field we genuinely don't know is empty
  // would be stating something as fact that we don't actually know — the
  // same fabrication risk this whole checklist was built to avoid. Website/
  // Phone are never Unknown-capable (always directly checkable), so they
  // keep the plain truthiness check.
  const statusOf = (field: string) => profileCompletion.checklist?.find((c) => c.field === field)?.status;
  add(statusOf('Business Description') !== 'Missing', 'Add Business Description', 'Missing description hurts local search visibility.');
  add(reviewCount > 0,                                   'Launch Review Collection Campaign','0 reviews found. Competitors with reviews rank much higher.');
  add(statusOf('Services Listed') !== 'Missing',          'Add Service Catalog',           'Services list is empty, reducing keyword matches.');
  add(!!business.website,                                'Add Website Link',                'A linked website is a major local ranking factor.');
  add(!!business.phone,                                  'Add Phone Number',                'Customers cannot contact you directly from Google Maps.');

  if (competitors.length > 0 && reviewCount > 0) {
    const avgReviews = competitors.reduce((acc: number, c: any) => acc + c.reviewCount, 0) / competitors.length;
    if (avgReviews > reviewCount * 2) {
      fixes.push({
        title: 'Aggressive Review Generation',
        reason: `Competitors average ${Math.round(avgReviews)} reviews. You need to close the gap to compete.`,
      });
    }
  }

  return fixes;
}

export function calculateBusinessIntelligence(
  _business: any,
  competitors: any[],
  reviewCount: number
): IBusinessIntelligence {
  const avgReviewCount = competitors.length > 0
    ? Math.round(competitors.reduce((acc: number, c: any) => acc + c.reviewCount, 0) / competitors.length)
    : 0;
  const reviewGap = avgReviewCount > reviewCount ? avgReviewCount - reviewCount : 0;

  return {
    competitivePosition: reviewCount === 0 ? 'New Entrant / Unestablished'
      : reviewCount > avgReviewCount ? 'Market Leader' : 'Challenger',
    // competitors.length is hard-capped at 10 by findCompetitors — "Highly
    // Saturated" at >=10 really means "hit our search cap," not a precise
    // saturation count, so the label says that rather than implying we
    // measured an exact number of competitors.
    marketSaturation: competitors.length >= 10 ? 'Highly Saturated (10+ nearby competitors found)'
      : competitors.length >= 5 ? 'Moderately Competitive' : 'Low Competition',
    reviewGap,
    // Renamed from visibilityGap (Aug 2026): this is computed purely from
    // the review-count gap, not any real search-visibility/rank data — the
    // old name/wording read as a ranking finding and was showing up as
    // "Severe Visibility Gap" in AI-generated weaknesses even on reports
    // where real rank data was unavailable (DataForSEO down), implying a
    // search-visibility problem we hadn't actually measured. Key AND
    // wording both changed so the AI (which sees this object's raw JSON
    // keys in its prompt) stops inheriting the old, inaccurate framing.
    reviewGapImpact: reviewGap > 50 ? 'Large review gap vs. nearby competitors.'
      : reviewGap > 0 ? 'Moderate review gap vs. nearby competitors.' : 'Review count is competitive with nearby businesses.',
    growthPotential: reviewCount === 0
      ? 'High potential with basic optimization.'
      : 'Incremental growth through consistent review collection.',
  };
}
