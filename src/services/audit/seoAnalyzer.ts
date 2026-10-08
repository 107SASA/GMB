import type { IProfileCompletion, IChecklistItem, IDataQuality, IAuditConfidence, IBusinessIntelligence } from '@/models/Audit';
import type { GeoGridPoint } from './geoGrid';
import type { RankingSummary } from './facts';
import { generateGeoGrid, GRID_SPACING_KM, GRID_AREA_SQ_KM } from './geoGrid';
import { fetchMapsLocalResultsBatch } from './dataForSeoClient';
import { buildObservation, DESCRIPTION_MIN_CHARS, type SearchKind, type SearchObservation } from './facts';
import {
  groupForField,
  buildCompletionLabel,
  buildCompletionPromptFact,
  type CompletionScope,
} from '@/lib/profileCompletion';

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

/** Values our own intake writes when Google gave us nothing — never evidence. */
const PLACEHOLDER_VALUES = new Set(['local business', 'unknown', 'n/a', 'na', '-']);
const realValue = (v: unknown): string => {
  const t = String(v ?? '').trim();
  return t && !PLACEHOLDER_VALUES.has(t.toLowerCase()) ? t : '';
};

/** Live GBP fields actually read this run (see auditService.ts). */
export interface GbpLiveRead {
  title?: string;
  description?: string;
  primaryPhone?: string;
  website?: string;
  primaryCategory?: string;
  additionalCategories?: string[];
  /** Formatted storefront address (only when read via GBP Intelligence). */
  address?: string;
}

/**
 * Profile completion — ONE formula for every surface:
 *   completionPercentage = Complete ÷ (Complete + Missing)
 * Unknown fields are excluded (never counted as missing).
 *
 * A field is only ever marked Missing when a Google source we actually read
 * confirms its absence:
 *   - Places Details snapshot (free report / onboarding pick / WhatsApp
 *     connect): phone, website, hours, photos.
 *   - Live GBP read (connected, full audits): description, phone, website,
 *     primary + additional categories.
 * A value we hold counts as Complete. Placeholder values our own intake
 * writes ("Local Business", "Unknown") count as nothing. Fields no code
 * reads from Google (services, social links, service area, videos, logo,
 * attributes, booking link) are always Unknown.
 */
export function calculateProfileCompletion(
  business: any,
  opts: {
    gbpLive?: GbpLiveRead | null;
    /** The target's public Maps listing as seen in ranking results (facts.publicProfileFromObservations). */
    publicProfile?: { observed: boolean; additionalCategories: string[] | null; bookingUrl: string | null } | null;
    /**
     * Field states proven by the GBP Intelligence snapshot (hours, services,
     * attributes, photos, videos, logo/cover, service area, booking/social
     * links — see services/gbp/intelligence/auditInput.ts). Only fields Google
     * actually answered are present; everything else keeps its own state.
     */
    gbpIntelStates?: Partial<Record<string, IChecklistItem['status']>>;
  } = {},
) {
  const checklist: IChecklistItem[] = [];
  const live = opts.gbpLive || null;
  const pub = opts.publicProfile?.observed ? opts.publicProfile : null;
  const push = (field: string, status: IChecklistItem['status']) =>
    checklist.push({ field, status, group: groupForField(field) });
  /** present → Complete; absent + verifiable → Missing; else Unknown. */
  const check = (field: string, present: boolean, absenceVerified: boolean) =>
    push(field, present ? 'Complete' : absenceVerified ? 'Missing' : 'Unknown');

  // Did we read the listing from Google Places / Maps (not just hold a name)?
  const placesSnapshot =
    !!(business.googlePlaceId || business.placeId) &&
    (typeof business.placesReviewCount === 'number' ||
      typeof business.photoCount === 'number' ||
      typeof business.hasHours === 'boolean' ||
      (Array.isArray(business.googleTypes) && business.googleTypes.length > 0));

  const name = realValue(live?.title) || realValue(business.name);
  const category = realValue(live?.primaryCategory) || realValue(business.userDefinedCategory) || realValue(business.category);
  const phone = live ? realValue(live.primaryPhone) : realValue(business.phone);
  const website = live ? realValue(live.website) : realValue(business.website);
  const address = realValue(live?.address) || realValue(business.address);

  check('Business Name', !!name, false);
  // Every Google listing must have a primary category; if we couldn't read
  // one, that is unknown — never "missing".
  check('Primary Category', !!category, false);
  check('Address', !!address, false);
  check('Phone', !!phone, placesSnapshot || !!live);
  check('Website', !!website, placesSnapshot || !!live);
  push('Business Hours', typeof business.hasHours === 'boolean' ? (business.hasHours ? 'Complete' : 'Missing') : 'Unknown');
  push('Business Photos', typeof business.photoCount === 'number' ? (business.photoCount > 0 ? 'Complete' : 'Missing') : 'Unknown');
  // Our `area` is a sublocality parsed from the address — not Google's
  // service-area field, which nothing reads. Always unknown.
  push('Service Area', 'Unknown');

  if (live) {
    const desc = String(live.description || '').trim();
    push('Business Description', desc.length >= DESCRIPTION_MIN_CHARS ? 'Complete' : 'Missing');
    push('Additional Categories', (live.additionalCategories || []).length > 0 ? 'Complete' : 'Missing');
  } else {
    push('Business Description', 'Unknown');
    // The public Maps listing can SHOW additional categories; when it shows
    // none that is not proof there are none, so absence stays Unknown.
    push('Additional Categories', pub?.additionalCategories?.length ? 'Complete' : 'Unknown');
  }

  for (const f of ['Services Listed', 'Social Links', 'Videos', 'Logo / Cover Image', 'Attributes']) {
    push(f, 'Unknown');
  }
  // Booking link: Complete when Google's public listing shows one; its
  // absence there is not verified, so it stays Unknown.
  push('Booking / Appointment Link', pub?.bookingUrl ? 'Complete' : 'Unknown');
  const hasGbpConnection = !!live;
  if (opts.gbpIntelStates) {
    for (const item of checklist) {
      const st = opts.gbpIntelStates[item.field];
      if (st) item.status = st;
    }
  }

  const completeCount = checklist.filter((c) => c.status === 'Complete').length;
  const missingCount  = checklist.filter((c) => c.status === 'Missing').length;
  const unknownCount  = checklist.filter((c) => c.status === 'Unknown').length;

  const placesCompleteCount = checklist.filter((c) => c.group === 'places' && c.status === 'Complete').length;
  const placesTotalCount = checklist.filter((c) => c.group === 'places' && c.status !== 'Unknown').length;
  const scope: CompletionScope = hasGbpConnection ? 'full' : 'places';
  const completionPercentage = completeCount + missingCount > 0
    ? Math.round((completeCount / (completeCount + missingCount)) * 100)
    : 0;

  // "N fields need a Google connection to check" — every field still Unknown.
  // Naturally 7 when keywords are already present pre-OAuth (Additional
  // Keywords is promoted to Complete), 8 when they aren't.
  const oauthPendingCount = unknownCount;

  const completionLabel = buildCompletionLabel({
    pct: completionPercentage,
    pending: oauthPendingCount,
    scope,
  });
  const completionPromptFact = buildCompletionPromptFact({
    completionPercentage,
    oauthPendingCount,
    checklist,
  });

  return {
    data: {
      completionPercentage,
      completionScope: scope,
      completionLabel,
      completionPromptFact,
      checklist,
      placesCompleteCount,
      placesTotalCount,
      oauthPendingCount,
      missingCount,
      unknownCount,
    },
    evidenceSource: hasGbpConnection
      ? 'Calculated from the live Google Business Profile read plus the Google Places listing. Complete ÷ (Complete + Missing); fields we could not read are Unknown and excluded.'
      : 'Calculated from the Google Places listing. Complete ÷ (Complete + Missing); fields Places does not expose (description, categories beyond the primary, services, social links, service area, media, attributes, booking) are Unknown and excluded, not counted as missing.'
  };
}

// ── Review Metrics ─────────────────────────────────────────────────────────────

export function calculateReviewMetrics(
  reviews: any[],
  placesSnapshot?: { rating?: number; reviewCount?: number },
  options: { periodDays?: number } = {},
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

  // Velocity over the real analysis window (reviews here are already
  // filtered to it), not the span between the oldest and newest review —
  // and never a placeholder (the old code returned 0.5 for a single review).
  const periodDays = options.periodDays && options.periodDays > 0 ? options.periodDays : null;
  const reviewsPerWeek = periodDays
    ? parseFloat((reviewCount / (periodDays / 7)).toFixed(1))
    : 0;

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
// NOT_FOUND_RANK (21) is how audits created before Sep 2026 stored "not in the
// top 20" (indistinguishable from a provider failure). New audits never write
// it — not-found is `rank: null` (facts.ts). Kept only so code reading OLD
// stored audits can recognise the value.
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

// Self-praise / ranking words that Google's own naming guidelines disallow in
// a Business Profile title — strip them before deriving a search phrase so we
// don't seed "top it training institute kolkata".
const SELF_PRAISE_WORDS = new Set([
  'top', 'best', 'no1', 'no', '1', 'number', 'premier', 'leading', 'famous',
  'finest', 'trusted', 'award', 'awarded', 'winning', 'official', 'authorized',
  'authorised', 'certified', 'genuine', 'original', 'the',
]);

// A stored Places category this vague is a weak signal — if the business
// NAME carries a real category anchor ("... IT Training Institute ...") that
// phrase is a better search term than the bucket word.
const WEAK_CATEGORY_VALUES = new Set([
  'educational institution', 'education', 'institution', 'institute',
  'school', 'academy', 'training centre', 'training center', 'point of interest',
  'store', 'shop', 'general contractor', 'contractor',
]);

// Category anchor words that commonly appear IN an SMB name and describe what
// it actually is. When one is present we take it plus up to 2 preceding
// descriptive words ("IT Training" + "Institute") as the category phrase.
const CATEGORY_ANCHORS = [
  'institute', 'academy', 'school', 'college', 'university', 'coaching',
  'classes', 'tuition', 'training', 'clinic', 'hospital', 'diagnostics',
  'pharmacy', 'dental', 'salon', 'spa', 'parlour', 'parlor', 'gym',
  'fitness', 'restaurant', 'cafe', 'bakery', 'kitchen', 'caterers',
  'catering', 'hotel', 'resort', 'store', 'mart', 'bazaar', 'boutique',
  'studio', 'photography', 'agency', 'consultancy', 'consultants',
  'solutions', 'technologies', 'systems', 'services', 'builders',
  'developers', 'interiors', 'architects', 'electricals', 'electronics',
  'automobiles', 'motors', 'garage', 'workshop', 'hardware', 'furniture',
  'jewellers', 'jewellery', 'opticals', 'eyewear', 'travels', 'tours',
  'logistics', 'packers', 'movers', 'law', 'advocates', 'associates',
];
const CATEGORY_ANCHOR_SET = new Set(CATEGORY_ANCHORS);

/** Extract a category phrase from a business name using a category anchor
 *  word plus up to 2 meaningful words in front of it. Returns '' if no
 *  anchor is present. */
function categoryPhraseFromName(cleanedWords: string[]): string {
  const lower = cleanedWords.map((w) => w.toLowerCase());
  // last anchor position (names read "Brand … Category")
  let anchorIdx = -1;
  for (let i = lower.length - 1; i >= 0; i--) {
    if (CATEGORY_ANCHOR_SET.has(lower[i])) { anchorIdx = i; break; }
  }
  if (anchorIdx === -1) return '';

  const out: string[] = [cleanedWords[anchorIdx]];
  let taken = 0;
  // Walk backwards from the anchor picking up to 2 descriptive words. Stop
  // before the first token of the name — that is almost always the brand
  // ("Peacock" in "Peacock Salon", "Desun" in "Desun Academy …").
  for (let i = anchorIdx - 1; i >= 1 && taken < 2; i--) {
    const w = lower[i];
    if (SELF_PRAISE_WORDS.has(w) || TRAILING_FILLER_WORDS.has(w) || w.length < 2) continue;
    out.unshift(cleanedWords[i]);
    taken++;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

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
  const catLower = cat.toLowerCase();
  const catIsReal = !!cat && !GENERIC_CATEGORY_VALUES.has(catLower);
  const catIsWeak = catIsReal && WEAK_CATEGORY_VALUES.has(catLower);

  // A specific, non-weak stored category always wins.
  if (catIsReal && !catIsWeak) return cat;

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

  // Best case: the name carries a real category anchor ("... IT Training
  // Institute ...") — that phrase beats a vague/absent stored category and
  // needs no "company" qualifier.
  const anchored = categoryPhraseFromName(words);
  if (anchored && anchored.split(' ').length >= 1) {
    // A weak stored category can still add a leading qualifier the name
    // lacked (rare) — but the anchored phrase is the spine.
    return anchored;
  }

  // A weak-but-present stored category is still better than a bare
  // brand-word + "company" guess.
  if (catIsWeak) return cat;

  // Sep 2026: with no real category and nothing but the brand name left,
  // there is no customer search term to measure — return '' ("category
  // unknown") instead of searching the business's own name (a real case:
  // "Mulsetu", Google category "Services", searched as "Mulsetu company" →
  // #1 everywhere, which measures brand lookups, not visibility).
  if (words.length === 0) return '';
  const brandFirst = words[0].toLowerCase();

  // Strip self-praise from the tail before taking the last word(s).
  while (words.length > 1 && SELF_PRAISE_WORDS.has(words[words.length - 1].toLowerCase())) {
    words = words.slice(0, -1);
  }

  const last = words[words.length - 1];
  const nameKeyword = words.length >= 2 && WEAK_TRAILING_WORDS.has(last.toLowerCase())
    ? words.slice(-2).join(' ')
    : last;
  if (!nameKeyword) return '';
  if (words.length === 1 || nameKeyword.toLowerCase().split(/\s+/).includes(brandFirst)) return '';

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
  const withCity = (k: string) => (cityLower && !k.toLowerCase().includes(cityLower) ? `${k} ${cityLower}` : k);

  let seedWords: string[] = [];
  if (business.keywords && business.keywords.length > 0) {
    seedWords = business.keywords.map((k: string) => String(k).trim()).filter(Boolean);
  } else if (business.services && business.services.length > 0) {
    seedWords = String(business.services).split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean);
  } else if (categoryLower) {
    seedWords = [categoryLower];
  }
  // No category and no keywords → nothing a customer would search for.
  if (seedWords.length === 0) return [];

  const primary = seedWords[0];
  const secondary = seedWords[1];
  const primaryNoCity = cityLower ? primary.replace(new RegExp(`\\s*\\b${escapeRegExp(cityLower)}\\b\\s*`, 'i'), ' ').trim() : primary;

  return Array.from(new Set([
    withCity(primary),
    withCity(`best ${primaryNoCity}`),
    withCity(`top ${primaryNoCity}`),
    `${primaryNoCity} near me`,
    secondary ? withCity(secondary) : categoryLower ? withCity(categoryLower) : '',
  ].map(k => k.trim().replace(/\s+/g, ' ')).filter(Boolean)));
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

/** Real 1-based position of the target in the results, or null when absent. */
function findTargetPosition(localResults: any[], business: any): number | null {
  const idx = findTargetIndex(localResults, business);
  return idx === -1 ? null : idx + 1;
}

/** Maps a DataForSEO result list into a facts-layer observation. null results = provider failure. */
function toObservation(
  keyword: string,
  kind: SearchKind,
  localResults: any[] | null,
  business: any,
  point?: { lat: number; lng: number } | null,
): SearchObservation {
  return buildObservation({
    keyword,
    kind,
    point: point ? { lat: point.lat, lng: point.lng } : null,
    results: localResults === null
      ? null
      : localResults.map((r: any) => ({
          name: r.title || '',
          placeId: r.place_id || undefined,
          cid: r.data_id || undefined,
          rating: typeof r.rating === 'number' ? r.rating : null,
          reviewCount: typeof r.reviews === 'number' ? r.reviews : null,
          category: r.category || null,
          address: r.address || null,
          website: r.website || null,
          phone: r.phone || null,
          additionalCategories: r.additionalCategories ?? null,
          hasHours: r.hasHours ?? null,
          bookingUrl: r.bookingUrl || null,
          isClaimed: r.isClaimed ?? null,
          totalPhotos: r.totalPhotos ?? null,
        })),
    targetPosition: localResults === null ? null : findTargetPosition(localResults, business),
    isTarget: (item) => isOwnBusiness(item.name, business) ||
      (!!item.placeId && collectPlaceIds(business).includes(item.placeId)),
  });
}

function findTargetIndex(localResults: any[], business: any): number {
  if (!localResults?.length) return -1;

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

  return idx;
}

function isOwnBusiness(resultName: string, business: any): boolean {
  const target = normalizeBusinessName(business.name || business.businessName || '');
  const other = normalizeBusinessName(resultName);
  if (!target || !other) return false;
  return namesLikelyMatch(target, other);
}

export interface KeywordRankSnapshotRow {
  keyword: string;
  observation: SearchObservation;
}

/**
 * Rank each keyword ONCE, at the business's own location — the cheap check
 * behind the free report's nearby-area / keyword rows. One batched
 * DataForSEO request. Never throws — a failed batch returns every keyword
 * as an 'unavailable' observation (never "not found").
 */
export async function fetchKeywordRankSnapshot(
  business: any,
  keywords: string[],
  opts: { kindOf?: (keyword: string) => SearchKind } = {},
): Promise<KeywordRankSnapshotRow[]> {
  const uniq = Array.from(new Set(keywords.map((k) => String(k || '').trim()).filter(Boolean)));
  if (uniq.length === 0) return [];

  const point = business.coordinates?.lat && business.coordinates?.lng
    ? { lat: Number(business.coordinates.lat), lng: Number(business.coordinates.lng) }
    : undefined;

  let batch: Array<any[] | null>;
  try {
    batch = await fetchMapsLocalResultsBatch(uniq.map((keyword) => ({ keyword, point, business })));
  } catch (err: any) {
    console.warn(`[seoAnalyzer] keyword snapshot batch failed: ${err?.message}`);
    batch = uniq.map(() => null);
  }

  return uniq.map((keyword, i) => ({
    keyword,
    observation: toObservation(keyword, opts.kindOf?.(keyword) ?? 'discovery', batch[i] ?? null, business, point ?? null),
  }));
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

export interface GeoGridRankingResult {
  /** One facts-layer observation per keyword × point searched (see facts.ts). */
  observations: SearchObservation[];
  gridResolution: 'full' | 'reduced';
  gridSpacingKm: number;
  /** 0 for a reduced grid (not a clean square — an area would be invented). */
  areaSqKm: number;
  evidenceSource: string;
  /** Set when the DataForSEO call itself failed (account/rate-limit/server/
   *  unknown) — every observation is then 'unavailable'. */
  fetchError?: { category: string; message: string } | null;
  /** Set when no search was attempted (e.g. no usable category). */
  notRunReason?: 'category_unknown';
}

/**
 * Geo-grid ranking via DataForSEO: 5 keywords × 9 points (3×3, 1.5 km
 * spacing) for a full audit; 1 keyword × 3 points in fastMode. Without
 * coordinates, each keyword is checked once at city level. Returns raw
 * per-search observations only — every statistic (averages, visibility,
 * competitors ahead) is computed from them in facts.ts.
 */
export async function fetchGeoGridRankings(
  business: any,
  options: { reduced?: boolean } = {},
): Promise<GeoGridRankingResult> {
  const gridResolution: 'full' | 'reduced' = options.reduced ? 'reduced' : 'full';
  const allKeywords = buildKeywords(business);
  const keywords = options.reduced ? allKeywords.slice(0, 1) : allKeywords;
  if (keywords.length === 0) {
    return {
      observations: [],
      gridResolution,
      gridSpacingKm: 0,
      areaSqKm: 0,
      evidenceSource: 'Not measured — no business category to search for (Google lists only a generic category).',
      fetchError: null,
      notRunReason: 'category_unknown',
    };
  }
  const hasCoords = !!(business.coordinates?.lat && business.coordinates?.lng);

  const gridPoints: Array<GeoGridPoint | null> = hasCoords
    ? (() => {
        const full = generateGeoGrid(business.coordinates.lat, business.coordinates.lng, GRID_SPACING_KM);
        return options.reduced ? reducedGridPoints(full) : full;
      })()
    : [null];
  const queries = keywords.flatMap((keyword) => gridPoints.map((point) => ({ keyword, point })));

  let fetchError: { category: string; message: string } | null = null;
  let batchResults: Array<any[] | null>;
  try {
    batchResults = await retryWithBackoff(() =>
      fetchMapsLocalResultsBatch(queries.map((q) => ({ keyword: q.keyword, point: q.point ?? undefined, business }))),
    );
  } catch (err: any) {
    fetchError = { category: err?.category || 'unknown', message: err?.message || String(err) };
    console.error(`[seoAnalyzer] DataForSEO Maps call failed (${fetchError.category}): ${fetchError.message}`);
    batchResults = queries.map(() => null);
  }

  const observations = queries.map(({ keyword, point }, i) =>
    toObservation(keyword, keyword === keywords[0] ? 'primary' : 'discovery', batchResults[i] ?? null, business, point),
  );

  const found = observations.filter((o) => o.found).length;
  const valid = observations.filter((o) => o.status === 'ok').length;
  return {
    observations,
    gridResolution,
    gridSpacingKm: hasCoords ? GRID_SPACING_KM : 0,
    areaSqKm: hasCoords && !options.reduced ? GRID_AREA_SQ_KM : 0,
    evidenceSource: fetchError
      ? `DataForSEO request failed (${fetchError.category}): ${fetchError.message}`
      : `${hasCoords ? `${gridPoints.length}-point grid, ${GRID_SPACING_KM} km spacing` : 'city-level search (no coordinates)'} | ` +
        `keywords: ${keywords.slice(0, 3).join(', ')} | found in top 20 in ${found} of ${valid} searches`,
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

export function findSelfPraiseTerm(nameLower: string): string | undefined {
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
  // No word-count check: length alone is not evidence of keyword stuffing.

  const nameLower = name.toLowerCase();
  const praiseTerm = findSelfPraiseTerm(nameLower);
  if (praiseTerm) {
    issues.push(`Title contains a self-praise keyword ("${praiseTerm}") — against Google's Business Profile naming guidelines`);
  }

  // No "primary keyword not in your title" check (removed Sep 2026): the
  // title must be the real-world business name — adding keywords to it is
  // keyword stuffing under Google's guidelines and a suspension risk, so
  // recommending it would push customers into a violation.

  return issues;
}

/**
 * Profile SEO score — deterministic, never AI-computed.
 *
 *   score = round(100 × Σ weight(checked & complete) ÷ Σ weight(checked))
 *
 * Each item reads the SAME checklist status as profile completion, so a
 * fact is evaluated once and in one way:
 *   Business Name 15 · Business Description 20 · Primary Category 15 ·
 *   Additional Categories 15 · Services Listed 10 · Website 15   (= 90)
 * An item whose status is Unknown is excluded from BOTH sums (no penalty
 * for data we could not read). "Profile completion ≥ 80%" is no longer an
 * item — it re-penalised the same fields a second time.
 * Title-quality checks (promotional words, length) are listed as
 * opportunities but carry no weight.
 */
export const SEO_SCORE_ITEMS: Array<{ field: string; weight: number; fix: string }> = [
  { field: 'Business Name', weight: 15, fix: 'Add the business name to the Google profile' },
  { field: 'Business Description', weight: 20, fix: `Write a business description of at least ${DESCRIPTION_MIN_CHARS} characters` },
  { field: 'Primary Category', weight: 15, fix: 'Set a primary category' },
  { field: 'Additional Categories', weight: 15, fix: 'Add additional categories that match services you offer' },
  { field: 'Services Listed', weight: 10, fix: 'List the services you offer' },
  { field: 'Website', weight: 15, fix: 'Link your website on the Google profile' },
];

export function calculateNativeSeoScore(business: any, profileCompletion: IProfileCompletion) {
  const statusOf = (field: string) => profileCompletion.checklist?.find((c) => c.field === field)?.status;
  let earned = 0;
  let checkedWeight = 0;
  let checkedItems = 0;
  const opps: string[] = [];
  for (const item of SEO_SCORE_ITEMS) {
    const st = statusOf(item.field);
    if (st !== 'Complete' && st !== 'Partial' && st !== 'Missing') continue; // Unknown / not in checklist
    checkedWeight += item.weight;
    checkedItems += 1;
    if (st === 'Missing') opps.push(item.fix);
    else earned += item.weight;
  }
  // null = nothing checkable → "Not measured", never a fabricated 0.
  const score: number | null = checkedWeight > 0 ? Math.round((earned / checkedWeight) * 100) : null;
  opps.push(...analyzeTitleSeo(business));

  return {
    score,
    checkedItems,
    totalItems: SEO_SCORE_ITEMS.length,
    missingKeywords: opps.filter(o => /categor/i.test(o)),
    optimizationOpportunities: opps,
  };
}

export function calculateAuditConfidence(
  profileCompletion: number,
  competitorCount: number,
  reviewCount: number,
  hasWebsite: boolean,
  rankingStatus: 'ok' | 'partial' | 'unavailable' | 'not_run' = 'ok',
): IAuditConfidence {
  let score = 0;
  const dataQuality: IDataQuality = {
    profileData:          profileCompletion > 50 ? 'Complete' : profileCompletion > 0 ? 'Partial' : 'Unavailable',
    competitorDiscovery:  competitorCount >= 5   ? 'Complete' : competitorCount > 0    ? 'Partial' : 'Unavailable',
    // Was hardcoded 'Complete' (+20) even when the ranking provider failed.
    keywordDiscovery:     rankingStatus === 'ok' ? 'Complete' : rankingStatus === 'partial' ? 'Partial' : 'Unavailable',
    reviewAnalysis:       reviewCount > 0        ? 'Complete' : 'Unavailable',
    websiteAnalysis:      hasWebsite             ? 'Complete' : 'Unavailable',
  };

  if (dataQuality.profileData === 'Complete')         score += 25;
  else if (dataQuality.profileData === 'Partial')     score += 12;
  if (dataQuality.competitorDiscovery === 'Complete') score += 25;
  else if (dataQuality.competitorDiscovery === 'Partial') score += 15;
  if (dataQuality.keywordDiscovery === 'Complete')    score += 20;
  else if (dataQuality.keywordDiscovery === 'Partial') score += 10;
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
  /** Lifetime Google review count; null = unknown (never treated as 0). */
  reviewCount: number | null,
  ranking?: RankingSummary | null,
  competitorsAheadCount?: number,
): IBusinessIntelligence {
  const counts = competitors
    .map((c: any) => c.reviewCount)
    .filter((n: any): n is number => typeof n === 'number');
  const avgReviewCount = counts.length > 0
    ? Math.round(counts.reduce((acc: number, n: number) => acc + n, 0) / counts.length)
    : 0;
  const reviewGap = reviewCount != null && avgReviewCount > reviewCount ? avgReviewCount - reviewCount : 0;

  // Position needs ranking evidence across several searches (Sep 2026):
  // "Market Leader" used to mean nothing more than "more reviews than the
  // competitor average", even with no ranking data at all.
  const tested = ranking?.testedCount ?? 0;
  let competitivePosition: string;
  if (!ranking || ranking.status === 'unavailable' || ranking.status === 'not_run' || tested === 0) {
    competitivePosition = 'Unknown — ranking could not be measured';
  } else if (tested >= 3 && (ranking.top3Rate ?? 0) >= 0.6) {
    competitivePosition = `Leading nearby — top 3 in ${ranking.top3Count} of ${tested} searches`;
  } else if (ranking.foundCount === 0) {
    competitivePosition = `Not yet visible — not in the top 20 in any of ${tested} searches`;
  } else {
    competitivePosition = `Challenger — in the top 20 in ${ranking.foundCount} of ${tested} searches`;
  }

  const ahead = competitorsAheadCount ?? competitors.length;
  const marketSaturation = tested > 0
    ? `${ahead} business${ahead === 1 ? '' : 'es'} observed above you across ${tested} search${tested === 1 ? '' : 'es'}`
    : 'Unknown — ranking could not be measured';

  return {
    competitivePosition,
    marketSaturation,
    reviewGap,
    reviewGapImpact: reviewCount == null
      ? 'Your Google review count could not be read, so it is not compared.'
      : counts.length < 2
      ? 'Not enough competitor review data to compare.'
      : reviewGap > 0
        ? `Businesses ranking near you average ${avgReviewCount} reviews; you have ${reviewCount}.`
        : 'Review count is at or above the average of businesses ranking near you.',
    growthPotential: reviewCount == null
      ? 'Unknown — review count not available.'
      : reviewCount === 0
      ? 'No reviews yet — review collection is the clearest starting point.'
      : 'Steady review collection and a complete profile are the controllable levers.',
  };
}
