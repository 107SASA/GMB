/**
 * The audit engine's "hard-coded truth" layer: normalized, deterministic
 * facts computed from real provider data, before any AI sees them.
 *
 * Rules this file enforces (see the Sep 2026 audit-engine correctness pass):
 *  - A search where the target is not in the top LOCAL_PACK_WINDOW results is
 *    `{ found: false, rank: null }` — never a numeric sentinel (the old 21).
 *    Averages are over FOUND searches only; visibility is reported separately.
 *  - A provider failure is `status: 'unavailable'` — a data-quality state,
 *    never "not found" and never a business problem.
 *  - "Competitors ahead" is a set of real businesses (deduped by place id /
 *    cid / name) that appeared above the target in a valid search — never
 *    arithmetic on an average rank.
 *  - Lifetime review totals (Google's count + rating) are kept separate from
 *    the recent analysis window (new reviews, velocity, response rate).
 *
 * Pure: no I/O, no `@/` imports, so it runs under `node --test` directly.
 */

/** Positions beyond this are displayed as "20+" and treated as not found. */
export const LOCAL_PACK_WINDOW = 20;

/** Businesses kept per search when the target was NOT found (storage cap). */
export const NOT_FOUND_AHEAD_CAP = 10;

/** One documented description rule, used by the checklist, SEO score and findings. */
export const DESCRIPTION_MIN_CHARS = 100;

// ── Ranking ────────────────────────────────────────────────────────────────

/** 'brand' = the search contains the business's own name — shown, but
 *  excluded from visibility and competitor statistics. */
export type SearchKind = 'primary' | 'nearby' | 'discovery' | 'brand';

export interface SearchResultItem {
  /** 1-based position in the Maps results. */
  position: number;
  name: string;
  placeId?: string;
  cid?: string;
  rating?: number | null;
  reviewCount?: number | null;
  category?: string | null;
  address?: string | null;
  /** Public Google listing fields (DataForSEO Maps item) — absent = not shown. */
  website?: string | null;
  phone?: string | null;
  additionalCategories?: string[] | null;
  hasHours?: boolean | null;
  bookingUrl?: string | null;
  isClaimed?: boolean | null;
  totalPhotos?: number | null;
}

export interface SearchObservation {
  keyword: string;
  kind: SearchKind;
  point?: { lat: number; lng: number } | null;
  /** 'unavailable' = the provider call failed for this search (not "not found"). */
  status: 'ok' | 'unavailable';
  found: boolean;
  /** Real 1-based position when found within LOCAL_PACK_WINDOW, otherwise null. */
  rank: number | null;
  /** Real businesses shown above the target (target excluded). */
  ahead: SearchResultItem[];
  /** The target's own listing as Google showed it in this search (public data). */
  target?: SearchResultItem;
  /** Other businesses in the top-20 window that were NOT above the target
   *  (identity + position only) — so a competitor's total appearances are
   *  measured, not just the searches where it beat the target. */
  others?: Array<Pick<SearchResultItem, 'name' | 'placeId' | 'cid' | 'position'>>;
}

export interface BuildObservationInput {
  keyword: string;
  kind: SearchKind;
  point?: { lat: number; lng: number } | null;
  /** Ordered provider results, or null when the provider call failed. */
  results: Array<Omit<SearchResultItem, 'position'>> | null;
  /** 1-based position of the target in `results`, or null when not present. */
  targetPosition: number | null;
  /** Extra guard so the target never appears in its own competitor list. */
  isTarget?: (item: Omit<SearchResultItem, 'position'>) => boolean;
}

/**
 * A Maps result that is a PLACE, not a business (a town/locality pin such as
 * "Ojhar — Maharashtra", seen live Sep 2026): no category, rating, reviews,
 * phone or website, and an address that is only a region name. It still
 * occupies a position (so the target's rank stays Google's literal position),
 * but it is never counted or shown as a competitor.
 */
export function isNonBusinessResult(r: Partial<SearchResultItem>): boolean {
  // Needs positive evidence of a region-only address — a missing address
  // alone never removes a result.
  return !r.category && r.rating == null && r.reviewCount == null && !r.phone && !r.website &&
    !!r.address && !/[\d,]/.test(String(r.address));
}

export function buildObservation(input: BuildObservationInput): SearchObservation {
  const { keyword, kind, point = null, results, targetPosition, isTarget } = input;
  if (results === null) {
    return { keyword, kind, point, status: 'unavailable', found: false, rank: null, ahead: [] };
  }
  const found = targetPosition != null && targetPosition >= 1 && targetPosition <= LOCAL_PACK_WINDOW;
  const aboveCount = found
    ? (targetPosition as number) - 1
    : Math.min(NOT_FOUND_AHEAD_CAP, results.length, targetPosition != null ? targetPosition - 1 : Infinity);
  const ahead = results
    .slice(0, aboveCount)
    .map((r, i) => ({ ...r, position: i + 1 }))
    .filter((r) => !!r.name && !(isTarget && isTarget(r)) && !isNonBusinessResult(r));
  const targetItem = targetPosition != null && targetPosition >= 1 ? results[targetPosition - 1] : undefined;
  const others = results
    .slice(0, LOCAL_PACK_WINDOW)
    .map((r, i) => ({ r, position: i + 1 }))
    .filter(({ r, position }) => position > aboveCount && position !== targetPosition && !!r.name && !(isTarget && isTarget(r)) && !isNonBusinessResult(r))
    .map(({ r, position }) => ({ name: r.name, placeId: r.placeId, cid: r.cid, position }));
  return {
    keyword, kind, point, status: 'ok', found, rank: found ? (targetPosition as number) : null, ahead,
    ...(targetItem ? { target: { ...targetItem, position: targetPosition as number } } : {}),
    ...(others.length ? { others } : {}),
  };
}

export interface RankingSummary {
  /** 'not_run' = no searches attempted; 'partial' = some searches failed. */
  status: 'ok' | 'partial' | 'unavailable' | 'not_run';
  totalSearches: number;
  /** Valid (status 'ok') searches — the denominator for every rate below. */
  testedCount: number;
  unavailableCount: number;
  foundCount: number;
  notFoundCount: number;
  /** Mean of real positions over FOUND searches only; null if none found. */
  averageObservedRank: number | null;
  bestRank: number | null;
  visibilityRate: number | null;
  notFoundRate: number | null;
  top3Count: number;
  top3Rate: number | null;
  top5Count: number;
  top5Rate: number | null;
  top10Count: number;
  top10Rate: number | null;
}

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

export function summarizeRankings(observations: SearchObservation[]): RankingSummary {
  const total = observations.length;
  const valid = observations.filter((o) => o.status === 'ok');
  const found = valid.filter((o) => o.found && o.rank != null);
  const ranks = found.map((o) => o.rank as number);
  const tested = valid.length;
  const rate = (n: number) => (tested > 0 ? round(n / tested) : null);
  const top3 = ranks.filter((r) => r <= 3).length;
  const top5 = ranks.filter((r) => r <= 5).length;
  const top10 = ranks.filter((r) => r <= 10).length;

  let status: RankingSummary['status'] = 'ok';
  if (total === 0) status = 'not_run';
  else if (tested === 0) status = 'unavailable';
  else if (tested < total) status = 'partial';

  return {
    status,
    totalSearches: total,
    testedCount: tested,
    unavailableCount: total - tested,
    foundCount: found.length,
    notFoundCount: tested - found.length,
    averageObservedRank: ranks.length ? round(ranks.reduce((a, b) => a + b, 0) / ranks.length, 1) : null,
    bestRank: ranks.length ? Math.min(...ranks) : null,
    visibilityRate: rate(found.length),
    notFoundRate: rate(tested - found.length),
    top3Count: top3,
    top3Rate: rate(top3),
    top5Count: top5,
    top5Rate: rate(top5),
    top10Count: top10,
    top10Rate: rate(top10),
  };
}

export interface KeywordRankingSummary extends RankingSummary {
  keyword: string;
  kind: SearchKind;
}

/** Per-keyword rollup (a primary keyword is checked from several grid points). */
export function summarizeByKeyword(observations: SearchObservation[]): KeywordRankingSummary[] {
  const groups = new Map<string, SearchObservation[]>();
  for (const o of observations) {
    const k = `${o.kind}::${o.keyword.toLowerCase()}`;
    const arr = groups.get(k) || [];
    arr.push(o);
    groups.set(k, arr);
  }
  return Array.from(groups.values()).map((obs) => ({
    keyword: obs[0].keyword,
    kind: obs[0].kind,
    ...summarizeRankings(obs),
  }));
}

/** Display adapter: the only place a not-found search becomes the "20+" label. */
export function formatObservedRank(found: boolean, rank: number | null, status: 'ok' | 'unavailable' = 'ok'): string {
  if (status === 'unavailable') return 'Unavailable';
  if (!found || rank == null) return `${LOCAL_PACK_WINDOW}+`;
  return `#${rank}`;
}

// ── Competitors ────────────────────────────────────────────────────────────

export interface CompetitorFact {
  key: string;
  name: string;
  placeId: string | null;
  cid: string | null;
  category: string | null;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** Valid searches in which this business was shown above the target. */
  searchesAhead: number;
  /** searchesAhead / all valid searches. */
  aheadRate: number | null;
  averageObservedRank: number | null;
  bestObservedRank: number | null;
  top5Count: number;
  keywords: string[];
  website: string | null;
  phone: string | null;
  additionalCategories: string[] | null;
  hasHours: boolean | null;
  bookingUrl: string | null;
  isClaimed: boolean | null;
  top3Count: number;
  /** Valid searches where it appeared in the top 20 at all (above or below the target). */
  appearances: number | null;
  /** Measured from how often it was above the target — never from one sighting. */
  relevance: CompetitorRelevance;
  source: 'dataforseo' | 'google_places';
  /** Not reliably measurable from the data we have — null, not a guess. */
  similarityScore: null;
}

/**
 * strong     — above the target in ≥ 2 searches AND ≥ half of the valid searches
 * moderate   — above the target in ≥ 2 searches
 * incidental — above the target once (never called a major competitor)
 * unmeasured — came from a fallback list, not from ranking results
 */
export type CompetitorRelevance = 'strong' | 'moderate' | 'incidental' | 'unmeasured';

export function competitorRelevance(searchesAhead: number, tested: number): CompetitorRelevance {
  if (searchesAhead >= 2 && tested > 0 && searchesAhead / tested >= 0.5) return 'strong';
  if (searchesAhead >= 2) return 'moderate';
  return 'incidental';
}

export function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(pvt|private|ltd|limited|llp|inc|llc|co|company|plc|corp|corporation)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function competitorKey(item: { placeId?: string | null; cid?: string | null; name: string }): string {
  if (item.placeId) return `pid:${item.placeId}`;
  if (item.cid) return `cid:${item.cid}`;
  return `name:${normalizeName(item.name)}`;
}

/**
 * Real businesses observed above the target, deduped across searches.
 * Only businesses above the target are retained per search, so their own
 * visibility across ALL searches is not known — `aheadRate` is what we can
 * actually measure.
 */
export function competitorsFromObservations(observations: SearchObservation[]): CompetitorFact[] {
  const valid = observations.filter((o) => o.status === 'ok');
  const tested = valid.length;
  const map = new Map<string, { item: SearchResultItem; positions: number[]; searches: Set<number>; keywords: Set<string> }>();
  const seenBelow = new Map<string, Set<number>>();

  valid.forEach((o, idx) => {
    for (const item of o.ahead) {
      const key = competitorKey(item);
      let entry = map.get(key);
      if (!entry) {
        entry = { item, positions: [], searches: new Set(), keywords: new Set() };
        map.set(key, entry);
      }
      // Later observations can fill fields an earlier one lacked.
      entry.item = {
        ...item,
        ...Object.fromEntries(Object.entries(entry.item).filter(([, v]) => v != null && v !== '')),
      } as SearchResultItem;
      entry.positions.push(item.position);
      entry.searches.add(idx);
      entry.keywords.add(o.keyword);
    }
    for (const other of o.others || []) {
      const key = competitorKey(other as any);
      const set = seenBelow.get(key) || new Set<number>();
      set.add(idx);
      seenBelow.set(key, set);
    }
  });

  return Array.from(map.entries())
    .map(([key, e]) => {
      const n = e.positions.length;
      return {
        key,
        name: e.item.name,
        placeId: e.item.placeId || null,
        cid: e.item.cid || null,
        category: e.item.category || null,
        address: e.item.address || null,
        rating: typeof e.item.rating === 'number' ? e.item.rating : null,
        reviewCount: typeof e.item.reviewCount === 'number' ? e.item.reviewCount : null,
        searchesAhead: e.searches.size,
        aheadRate: tested > 0 ? round(e.searches.size / tested) : null,
        averageObservedRank: n ? round(e.positions.reduce((a, b) => a + b, 0) / n, 1) : null,
        bestObservedRank: n ? Math.min(...e.positions) : null,
        top5Count: e.positions.filter((p) => p <= 5).length,
        top3Count: e.positions.filter((p) => p <= 3).length,
        keywords: Array.from(e.keywords),
        website: e.item.website || null,
        phone: e.item.phone || null,
        additionalCategories: Array.isArray(e.item.additionalCategories) ? e.item.additionalCategories : null,
        hasHours: typeof e.item.hasHours === 'boolean' ? e.item.hasHours : null,
        bookingUrl: e.item.bookingUrl || null,
        isClaimed: typeof e.item.isClaimed === 'boolean' ? e.item.isClaimed : null,
        appearances: new Set([...e.searches, ...(seenBelow.get(key) || [])]).size,
        relevance: competitorRelevance(e.searches.size, tested),
        source: 'dataforseo' as const,
        similarityScore: null,
      };
    })
    .sort(
      (a, b) =>
        b.searchesAhead - a.searchesAhead ||
        (a.averageObservedRank ?? 99) - (b.averageObservedRank ?? 99),
    );
}

export interface CompetitorsAhead {
  count: number;
  names: string[];
  /** Valid searches the count was drawn from. */
  searchesChecked: number;
}

export function competitorsAhead(observations: SearchObservation[]): CompetitorsAhead {
  const comps = competitorsFromObservations(observations);
  return {
    count: comps.length,
    names: comps.map((c) => c.name),
    searchesChecked: observations.filter((o) => o.status === 'ok').length,
  };
}

// ── Reviews ────────────────────────────────────────────────────────────────

export type ReviewSampleSize = 'none' | 'very_small' | 'small' | 'moderate' | 'large';

/** Descriptive bucket for how much review evidence exists — not a verdict. */
export function reviewSampleSize(count: number | null): ReviewSampleSize | null {
  if (count == null) return null;
  if (count <= 0) return 'none';
  if (count < 10) return 'very_small';
  if (count < 50) return 'small';
  if (count < 200) return 'moderate';
  return 'large';
}

export type LifetimeReviewSource = 'google_places' | 'serpapi' | 'gbp_api';

export interface LifetimeReviewInput {
  count: number | null;
  rating: number | null;
  source: LifetimeReviewSource;
}

export interface RecentReviewInput {
  periodDays: number;
  /** True when a review sync actually covered the window (dates are real). */
  synced: boolean;
  /** hasReply null = the sync that stored this review did not read owner
   *  replies (records from before reply capture) — unknown, never "unanswered". */
  reviews: Array<{ rating: number; hasReply: boolean | null; sentiment?: string; text?: string }>;
}

export interface ReviewFacts {
  lifetime: {
    status: 'verified' | 'unknown';
    totalCount: number | null;
    rating: number | null;
    source: LifetimeReviewSource | null;
    sampleSize: ReviewSampleSize | null;
  };
  recent: {
    status: 'verified' | 'unknown';
    periodDays: number;
    newReviewCount: number | null;
    /** newReviewCount / (periodDays / 7). Null when the window wasn't synced. */
    reviewsPerWeek: number | null;
    /** Share of the window's reviews with an owner reply (0..1). Null when
     *  not synced, no reviews, or reply data was not captured for any of them. */
    responseRate: number | null;
    /** Reviews in the window whose reply status is unknown (not re-synced yet). */
    replyUnknownCount: number;
    sentiment: { positive: number; neutral: number; negative: number } | null;
    /** Reviews with real text available for theme analysis. */
    textSampleCount: number;
  };
}

export function buildReviewFacts(lifetime: LifetimeReviewInput | null, recent: RecentReviewInput): ReviewFacts {
  const lifetimeOk = !!lifetime && typeof lifetime.count === 'number' && lifetime.count >= 0;
  const rs = recent.reviews || [];
  const n = rs.length;
  const pct = (k: number) => (n > 0 ? round(k / n) : 0);
  const positive = rs.filter((r) => r.sentiment === 'positive').length;
  const negative = rs.filter((r) => r.sentiment === 'negative' || r.sentiment === 'critical').length;

  return {
    lifetime: {
      status: lifetimeOk ? 'verified' : 'unknown',
      totalCount: lifetimeOk ? (lifetime!.count as number) : null,
      rating: lifetimeOk && typeof lifetime!.rating === 'number' ? lifetime!.rating : null,
      source: lifetimeOk ? lifetime!.source : null,
      sampleSize: lifetimeOk ? reviewSampleSize(lifetime!.count) : null,
    },
    recent: {
      status: recent.synced ? 'verified' : 'unknown',
      periodDays: recent.periodDays,
      newReviewCount: recent.synced ? n : null,
      reviewsPerWeek: recent.synced && recent.periodDays > 0 ? round(n / (recent.periodDays / 7), 1) : null,
      // Only reviews whose reply status was actually read count; if any are
      // unknown the rate is not reported (a partial rate would mislead).
      responseRate: recent.synced && n > 0 && rs.every((r) => r.hasReply !== null)
        ? round(rs.filter((r) => r.hasReply === true).length / n)
        : null,
      replyUnknownCount: rs.filter((r) => r.hasReply === null).length,
      sentiment: recent.synced && n > 0 ? { positive: pct(positive), neutral: pct(n - positive - negative), negative: pct(negative) } : null,
      textSampleCount: rs.filter((r) => (r.text || '').trim().length >= 20).length,
    },
  };
}

export interface ReviewComparison {
  targetCount: number;
  targetRating: number | null;
  competitorsCompared: number;
  medianCompetitorReviewCount: number;
  medianCompetitorRating: number | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Lifetime review volume vs. the real businesses observed above the target. */
export function compareReviews(reviews: ReviewFacts, competitors: CompetitorFact[]): ReviewComparison | null {
  if (reviews.lifetime.status !== 'verified' || reviews.lifetime.totalCount == null) return null;
  const counts = competitors.map((c) => c.reviewCount).filter((v): v is number => typeof v === 'number');
  if (counts.length < 2) return null;
  const ratings = competitors.map((c) => c.rating).filter((v): v is number => typeof v === 'number' && v > 0);
  return {
    targetCount: reviews.lifetime.totalCount,
    targetRating: reviews.lifetime.rating,
    competitorsCompared: counts.length,
    medianCompetitorReviewCount: Math.round(median(counts)),
    medianCompetitorRating: ratings.length ? round(median(ratings), 1) : null,
  };
}

// ── Profile ────────────────────────────────────────────────────────────────

export type FieldState = 'verified_present' | 'verified_missing' | 'unknown' | 'not_applicable';

export function profileFieldStates(
  checklist: Array<{ field: string; status: string }>,
): Record<string, FieldState> {
  const out: Record<string, FieldState> = {};
  for (const c of checklist || []) {
    out[c.field] =
      c.status === 'Complete' || c.status === 'Partial'
        ? 'verified_present'
        : c.status === 'Missing'
          ? 'verified_missing'
          : 'unknown';
  }
  return out;
}

// ── Suspension risk ────────────────────────────────────────────────────────

export interface SuspensionRisk {
  /** A documented heuristic category — NOT a measured probability. */
  level: 'Low' | 'Medium' | 'High';
  reasons: string[];
  basis: 'heuristic';
}

/**
 * Heuristic built only from checks we actually ran against Google's
 * Business Profile naming guidelines. There is no statistically defensible
 * suspension probability, so none is shown.
 */
export function suspensionRiskHeuristic(input: { selfPraiseTerm?: string | null }): SuspensionRisk {
  const reasons: string[] = [];
  if (input.selfPraiseTerm) {
    reasons.push(`Business title contains the promotional term "${input.selfPraiseTerm}", which Google's naming guidelines don't allow`);
  }
  // Title word count is NOT evidence of keyword stuffing (removed Sep 2026):
  // many real business names are long. Only a concrete guideline breach counts.
  const level: SuspensionRisk['level'] = reasons.length ? 'Medium' : 'Low';
  return { level, reasons, basis: 'heuristic' };
}

// ── Map grid (display shape) ───────────────────────────────────────────────

export interface GridPoint {
  lat: number;
  lng: number;
  /** Real position when found in the top LOCAL_PACK_WINDOW, else null. */
  rank: number | null;
  found: boolean;
  status: 'ok' | 'unavailable';
}

export interface GridKeyword {
  keyword: string;
  /** Mean over FOUND points only; null when never found. */
  avgRank: number | null;
  points: GridPoint[];
  summary: RankingSummary;
}

/**
 * The map/grid view of the primary-keyword searches: one point per grid
 * location, built from the same observations as every ranking statistic, so
 * the map, its legend and the numbers under it can never disagree.
 */
export function gridFromObservations(observations: SearchObservation[]): GridKeyword[] {
  const withPoints = observations.filter((o) => o.kind === 'primary' && o.point);
  const byKeyword = new Map<string, SearchObservation[]>();
  for (const o of withPoints) {
    const arr = byKeyword.get(o.keyword) || [];
    arr.push(o);
    byKeyword.set(o.keyword, arr);
  }
  return Array.from(byKeyword.entries()).map(([keyword, obs]) => {
    const summary = summarizeRankings(obs);
    return {
      keyword,
      avgRank: summary.averageObservedRank,
      summary,
      points: obs.map((o) => ({ lat: o.point!.lat, lng: o.point!.lng, rank: o.rank, found: o.found, status: o.status })),
    };
  });
}

// ── Branded searches ───────────────────────────────────────────────────────

const LEGAL_WORDS = /\b(pvt\.?|private|ltd\.?|limited|llp|inc\.?|llc|co\.?|company|plc|corp\.?|corporation)\b/gi;
const PRAISE_WORDS = /\b(top|best|no\.?\s*1|number\s*1|#1|premier|leading|famous|finest|trusted|official)\b/gi;

/** The business's distinctive name phrase ("Desun Academy - Top IT…" → "desun academy"). */
export function brandPhrase(businessName: string): string {
  const head = String(businessName || '').split(/\s[-–|]\s|,|\(/)[0];
  const words = head
    .replace(LEGAL_WORDS, ' ')
    .replace(PRAISE_WORDS, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  return words.join(' ');
}

/**
 * A search containing the business's own name measures brand lookups, not
 * visibility to new customers — ranking #1 for your own name is expected.
 * Such searches are kind 'brand' and excluded from every visibility /
 * competitor statistic. If the brand phrase IS the category phrase (a
 * business literally named "Dental Clinic"), nothing is treated as brand.
 */
export function isBrandedKeyword(keyword: string, businessName: string, searchCategory = ''): boolean {
  const phrase = brandPhrase(businessName);
  if (!phrase || phrase.length < 3) return false;
  const cat = String(searchCategory || '').toLowerCase();
  if (cat && (cat.includes(phrase) || phrase.includes(cat))) return false;
  const kw = ` ${String(keyword || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `;
  return kw.includes(` ${phrase} `);
}

// ── Public listing profile + deterministic competitor comparison ──────────

export interface PublicListingProfile {
  /** Seen in at least one search result (so the fields below are Google's). */
  observed: boolean;
  category: string | null;
  additionalCategories: string[] | null;
  website: string | null;
  phone: string | null;
  hasHours: boolean | null;
  bookingUrl: string | null;
  isClaimed: boolean | null;
  totalPhotos: number | null;
}

/** The target's public Google listing as it appeared in ranking results. */
export function publicProfileFromObservations(observations: SearchObservation[]): PublicListingProfile {
  const t = observations.find((o) => o.status === 'ok' && o.target)?.target;
  return {
    observed: !!t,
    category: t?.category ?? null,
    additionalCategories: Array.isArray(t?.additionalCategories) ? (t!.additionalCategories as string[]) : null,
    website: t?.website ?? null,
    phone: t?.phone ?? null,
    hasHours: typeof t?.hasHours === 'boolean' ? t.hasHours : null,
    bookingUrl: t?.bookingUrl ?? null,
    isClaimed: typeof t?.isClaimed === 'boolean' ? t.isClaimed : null,
    totalPhotos: typeof t?.totalPhotos === 'number' ? t.totalPhotos : null,
  };
}

export interface CompetitorComparison {
  competitorsCompared: number;
  medianRating: number | null;
  medianReviewCount: number | null;
  /** Share (0..1) of compared competitors whose public listing shows it. */
  withWebsite: number | null;
  withBookingLink: number | null;
  withAdditionalCategories: number | null;
  claimed: number | null;
  /** Competitors in the top 3 of at least one valid search. */
  inTop3Somewhere: number;
  target: {
    rating: number | null;
    reviewCount: number | null;
    hasWebsite: boolean | null;
    hasBookingLink: boolean | null;
    additionalCategories: number | null;
    top3Searches: number;
    top5Searches: number;
    searches: number;
  };
}

/**
 * Deterministic target-vs-competitor comparison over the real businesses
 * observed above the target (up to the 10 seen most often). Only what the
 * listings actually show is compared; a null means not shown / unknown.
 */
export function compareCompetitors(
  competitors: CompetitorFact[],
  target: { rating: number | null; reviewCount: number | null; profile: PublicListingProfile; ranking: RankingSummary },
): CompetitorComparison | null {
  const set = competitors.filter((c) => c.source === 'dataforseo').slice(0, 10);
  if (set.length === 0) return null;
  const share = (pred: (c: CompetitorFact) => boolean | null) => {
    const known = set.map(pred).filter((v): v is boolean => v !== null);
    return known.length ? round(known.filter(Boolean).length / known.length, 2) : null;
  };
  const ratings = set.map((c) => c.rating).filter((v): v is number => typeof v === 'number' && v > 0);
  const counts = set.map((c) => c.reviewCount).filter((v): v is number => typeof v === 'number');
  return {
    competitorsCompared: set.length,
    medianRating: ratings.length ? round(median(ratings), 1) : null,
    medianReviewCount: counts.length ? Math.round(median(counts)) : null,
    withWebsite: share((c) => (c.website === null ? false : true)),
    withBookingLink: share((c) => !!c.bookingUrl),
    withAdditionalCategories: share((c) => (c.additionalCategories === null ? null : c.additionalCategories.length > 0)),
    claimed: share((c) => c.isClaimed),
    inTop3Somewhere: set.filter((c) => c.top3Count > 0).length,
    target: {
      rating: target.rating,
      reviewCount: target.reviewCount,
      hasWebsite: target.profile.observed ? !!target.profile.website : null,
      hasBookingLink: target.profile.observed ? !!target.profile.bookingUrl : null,
      additionalCategories: target.profile.additionalCategories ? target.profile.additionalCategories.length : null,
      top3Searches: target.ranking.top3Count,
      top5Searches: target.ranking.top5Count,
      searches: target.ranking.testedCount,
    },
  };
}
