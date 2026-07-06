import axios from 'axios';
import type { IProfileCompletion, IChecklistItem, IDataQuality, IAuditConfidence, IBusinessIntelligence, IGeoGridKeyword, IKeywordRank } from '@/models/Audit';
import type { GeoGridPoint } from './geoGrid';
import { generateGeoGrid, GRID_SPACING_KM, GRID_AREA_SQ_KM } from './geoGrid';

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const BASE_URL = "https://serpapi.com/search.json";

// ── Profile Completion ─────────────────────────────────────────────────────────
//
// Status meanings:
//   Complete  – field is present and populated
//   Missing   – field is definitely absent
//   Unknown   – requires GBP OAuth API access we don't have; scored as 0.5
//
// Scoring: Complete=1, Unknown=0.5, Missing/Partial=0

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

  // Fields we can definitively check from stored data
  add('Business Name',      !!business.name);
  add('Primary Category',   !!business.category || !!business.userDefinedCategory);
  add('Additional Keywords', !!business.keywords && business.keywords.length > 0);
  add('Business Description', !!business.description && business.description.length > 50);
  add('Services Listed',    !!business.services && business.services.length > 0);
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
  add('Social Links', hasSocial);

  add('WhatsApp Connected',  !!(business.whatsappConfig?.isConnected));

  // These two are populated from the SerpApi place-details response during data_id
  // resolution. If they've never been resolved, status is Unknown (benefit of the doubt).
  addUnknown('Business Photos',  business.photoCount, (business.photoCount ?? 0) > 0);
  addUnknown('Business Hours',   business.hasHours,    !!business.hasHours);

  // These require GBP Management API (OAuth) – we cannot verify them, mark Unknown
  const gbpOnly = ['Videos', 'Logo / Cover Image', 'Attributes', 'Booking / Appointment Link'];
  for (const f of gbpOnly) {
    checklist.push({ field: f, status: 'Unknown' });
  }

  // Score: Complete=1, Unknown=0.5, Missing=0
  const score = checklist.reduce((acc, c) => {
    if (c.status === 'Complete') return acc + 1;
    if (c.status === 'Unknown')  return acc + 0.5;
    return acc;
  }, 0);
  const completionPercentage = Math.round((score / checklist.length) * 100);

  return {
    data: { completionPercentage, checklist },
    evidenceSource: 'Calculated from connected GBP data. Fields marked Unknown require GBP Management API access.'
  };
}

// ── Review Metrics ─────────────────────────────────────────────────────────────

export function calculateReviewMetrics(reviews: any[]) {
  if (!reviews || reviews.length === 0) {
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

// ── Concurrency + retry helpers ────────────────────────────────────────────────

async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function run() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, run));
  return results;
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status: number | undefined = err?.response?.status;
      const retryable = status === 429 || (status != null && status >= 500);
      if (!retryable || attempt === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, (2 ** attempt) * 1000));
    }
  }
  throw new Error('unreachable');
}

// ── Geo-grid keyword ranking via SerpApi ───────────────────────────────────────
// Checks rank from 9 points in a 3×3 grid (1.5 km spacing) around the business.
// Harvests local-pack competitors from the same 45 responses at no extra cost.

const NOT_FOUND_RANK = 21;

function buildKeywords(business: any): string[] {
  const categoryLower = (business.category || 'business').toLowerCase();
  const cityLower = (business.city || '').toLowerCase();

  let seedWords: string[] = [];
  if (business.keywords && business.keywords.length > 0) {
    seedWords = business.keywords;
  } else if (business.services && business.services.length > 0) {
    seedWords = String(business.services).split(/[,;]+/).map((s: string) => s.trim());
  } else {
    seedWords = [categoryLower];
  }

  return [
    `${seedWords[0]} ${cityLower}`,
    `best ${seedWords[0]} ${cityLower}`,
    `top ${seedWords[0]} ${cityLower}`,
    `${seedWords[0]} near me`,
    seedWords[1] ? `${seedWords[1]} ${cityLower}` : `${cityLower} ${categoryLower}`,
  ].map(k => k.trim());
}

function findTargetRank(localResults: any[], business: any): number {
  let idx = -1;
  if (business.placeId || business.serpApiDataId) {
    idx = localResults.findIndex((r: any) =>
      (business.placeId && r.place_id === business.placeId) ||
      (business.serpApiDataId && r.data_id === business.serpApiDataId),
    );
  }
  if (idx === -1) {
    idx = localResults.findIndex((r: any) =>
      r.title?.toLowerCase().includes(business.name.toLowerCase()) ||
      business.name.toLowerCase().includes(r.title?.toLowerCase()),
    );
  }
  return idx === -1 ? NOT_FOUND_RANK : idx + 1;
}

export async function fetchGeoGridRankings(business: any): Promise<{
  geoGridRank: {
    keywords: IGeoGridKeyword[];
    overallAvgRank: number;
    gridSpacingKm: number;
    areaSqKm: number;
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
}> {
  const keywords = buildKeywords(business);

  // ── No coordinates → single-point fallback ───────────────────────────────────
  if (!business.coordinates?.lat || !business.coordinates?.lng) {
    const rawResults: any[][] = [];

    const legacyRankings: IKeywordRank[] = await Promise.all(
      keywords.map(async (keyword, idx) => {
        try {
          const res = await axios.get(BASE_URL, {
            params: { engine: 'google_maps', q: keyword, api_key: SERPAPI_KEY },
            timeout: 15000,
          });
          const localResults: any[] = res.data.local_results || [];
          rawResults[idx] = localResults;
          const rank = findTargetRank(localResults, business);
          return { keyword, rank, sourceQuery: keyword, confidence: rank < NOT_FOUND_RANK ? 'High' : 'Low' };
        } catch {
          rawResults[idx] = [];
          return { keyword, rank: NOT_FOUND_RANK, sourceQuery: keyword, confidence: 'Low' };
        }
      }),
    );

    // Harvest competitors from the same SerpApi responses so the fallback is useful
    const competitorMap = new Map<string, { name: string; avgRank: number; rating?: number; reviewCount?: number }>();
    for (const localResults of rawResults) {
      for (const r of localResults.slice(0, 8)) {
        if (!r.title) continue;
        const key = r.title.toLowerCase().trim();
        if (key === (business.name || '').toLowerCase().trim()) continue;
        if (!competitorMap.has(key)) {
          competitorMap.set(key, { name: r.title, avgRank: NOT_FOUND_RANK, rating: r.rating, reviewCount: r.reviews });
        }
      }
    }
    const localPackCompetitors = Array.from(competitorMap.values()).slice(0, 5);

    return {
      geoGridRank: null,
      localPackCompetitors,
      legacyRankings,
      evidenceSource: `Single-point SERP data (no coordinates): ${keywords.slice(0, 3).join(', ')}`,
    };
  }

  // ── 3×3 geo-grid: 5 keywords × 9 points = 45 SerpApi calls ─────────────────
  const gridPoints: GeoGridPoint[] = generateGeoGrid(
    business.coordinates.lat,
    business.coordinates.lng,
    GRID_SPACING_KM,
  );

  type TaskResult = {
    keyword: string;
    point: GeoGridPoint;
    rank: number;
    competitors: Array<{ name: string; rank: number; rating?: number; reviewCount?: number; placeId?: string }>;
  };

  const tasks = keywords.flatMap(keyword =>
    gridPoints.map(point => async (): Promise<TaskResult> => {
      try {
        const res = await retryWithBackoff(() =>
          axios.get(BASE_URL, {
            params: {
              engine: 'google_maps',
              q: keyword,
              ll: `@${point.lat},${point.lng},14z`,
              api_key: SERPAPI_KEY,
            },
            timeout: 15000,
          }),
        );

        const localResults: any[] = res.data.local_results || [];
        const rank = findTargetRank(localResults, business);
        const rankIdx = rank - 1; // 0-based index of target, or -1 if not found

        // Collect results ranked above the target (or top 5 when target not found)
        const aboveCount = rank === NOT_FOUND_RANK
          ? Math.min(5, localResults.length)
          : rankIdx;

        const competitors = localResults.slice(0, aboveCount)
          .map((r: any, i: number) => ({
            name: (r.title || '') as string,
            rank: i + 1,
            rating: r.rating as number | undefined,
            reviewCount: r.reviews as number | undefined,
            placeId: (r.place_id || r.data_id) as string | undefined,
          }))
          .filter(c => c.name);

        return { keyword, point, rank, competitors };
      } catch {
        return { keyword, point, rank: NOT_FOUND_RANK, competitors: [] };
      }
    }),
  );

  const allResults: TaskResult[] = await withConcurrency(tasks, 6);

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
    .slice(0, 5);

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
      areaSqKm: GRID_AREA_SQ_KM,
    },
    localPackCompetitors,
    legacyRankings,
    evidenceSource:
      `Geo-grid SERP: 3×3, ${GRID_SPACING_KM} km spacing, ${GRID_AREA_SQ_KM} sq km ` +
      `around [${business.coordinates.lat}, ${business.coordinates.lng}] | ` +
      `keywords: ${keywords.slice(0, 3).join(', ')}`,
  };
}

// ── V7 Native Analyzers ────────────────────────────────────────────────────────

export function calculateNativeSeoScore(business: any, profileCompletion: IProfileCompletion) {
  let score = 0;
  const opps: string[] = [];

  const add = (condition: boolean, weight: number, opp: string) => {
    if (condition) score += weight;
    else opps.push(opp);
  };

  add(!!business.description && business.description.length > 100, 25, 'Expand Business Description to 100+ characters');
  add(!!business.category || !!business.userDefinedCategory,        20, 'Set a Primary Category');
  add(!!business.keywords && business.keywords.length > 0,          15, 'Add Keywords / Additional Categories');
  add(!!business.services && business.services.length > 0,          15, 'Populate Service Catalog');
  add(!!business.website,                                            15, 'Link a Website for local authority');
  add(profileCompletion.completionPercentage >= 80,                  10, 'Improve overall Profile Completion to >80%');

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
  _profileCompletion: IProfileCompletion,
  reviewCount: number,
  competitors: any[]
) {
  const fixes: any[] = [];
  const add = (condition: boolean, title: string, reason: string) => {
    if (!condition) fixes.push({ title, reason });
  };

  add(!!business.description,                            'Add Business Description',        'Missing description hurts local search visibility.');
  add(reviewCount > 0,                                   'Launch Review Collection Campaign','0 reviews found. Competitors with reviews rank much higher.');
  add(!!business.services && business.services.length > 0, 'Add Service Catalog',           'Services list is empty, reducing keyword matches.');
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
    marketSaturation: competitors.length >= 10 ? 'Highly Saturated'
      : competitors.length >= 5 ? 'Moderately Competitive' : 'Low Competition',
    reviewGap,
    visibilityGap: reviewGap > 50 ? 'Severe visibility gap due to low review volume.'
      : reviewGap > 0 ? 'Moderate visibility gap.' : 'Strong visibility.',
    growthPotential: reviewCount === 0
      ? 'High potential with basic optimization.'
      : 'Incremental growth through consistent review collection.',
  };
}
