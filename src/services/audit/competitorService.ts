import axios from 'axios';
import { resolveSearchCategory } from './seoAnalyzer';
import { deriveCategory, GENERIC_PLACE_TYPES } from '@/services/google/places';

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place/textsearch/json';

export interface Competitor {
  name: string;
  rating: number;
  reviewCount: number;
  category: string;
  address?: string;
  website?: string;
  distance?: number;
  similarityScore?: number;
  strengthScore?: number;
  gapAnalysis?: {
    missingAdvantages: string[];
    gapScore: number;
  };
}

export interface BusinessData {
  businessName: string;
  category: string;
  city: string;
  area: string;
  state: string;
  country: string;
  reviewCount: number;
  website?: string;
  /** Raw Places `types[]` for the TARGET business itself, when known (set
   *  during free-report intake — see Business.googleTypes). Enables a real
   *  type-to-type relevance comparison in isRelevantCandidate instead of the
   *  looser label-word fallback. */
  googleTypes?: string[];
}

export function isEnterpriseBrand(name: string, reviewCount: number): boolean {
  if (reviewCount > 10000) return true;
  const enterpriseNames = [
    'tcs', 'tata consultancy services', 'infosys', 'wipro', 'hcl', 'google', 'microsoft', 'amazon',
    'cognizant', 'accenture', 'capgemini', 'ibm', 'oracle', 'cisco', 'apple', 'facebook', 'meta', 'desun hospital',
    'tech mahindra',
  ];
  const lowerName = name.toLowerCase();
  return enterpriseNames.some(ent => lowerName.includes(ent) && lowerName.length <= ent.length + 10);
}

export function classifyBusinessTier(reviewCount: number, hasWebsite: boolean, isEnterprise: boolean): string {
  if (isEnterprise) return 'Enterprise';
  if (reviewCount >= 1000) return 'Large Business';
  if (reviewCount >= 250) return 'Mid Market';
  if (reviewCount >= 50 || hasWebsite) return 'Small Business';
  return 'Micro Business';
}

// Filler words stripped before comparing two category labels — neither
// "company"/"services" nor location/superlative words carry any topical
// signal ("IT Services Company" vs "Cleaning Services Company" would
// wrongly "overlap" on just "services company" otherwise).
const CATEGORY_STOPWORDS = new Set([
  'in', 'the', 'and', 'of', 'for', 'near', 'me', 'best', 'top', 'company',
  'companies', 'service', 'services', 'a', 'an', '&', 'local', 'business',
]);

function tokenizeCategoryLabel(label: string): Set<string> {
  return new Set(
    label
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 3 && !CATEGORY_STOPWORDS.has(w))
  );
}

/**
 * Real domain-relevance check — added Aug 2026 after a confirmed live case
 * (generic stored category "Services" → query "services in Kolkata" →
 * Google Places textsearch returned ambulance/cleaning/massage/catering
 * businesses, sharing no actual line of business with the audited company).
 * `category` on each candidate used to just copy the TARGET's own category
 * onto every result (competitor.category = businessData.category below) —
 * meaningless as a filter signal since it was identical for every row by
 * construction.
 *
 * Two comparison modes, in preference order:
 *  1. Type-to-type (when `targetTypes` is known, i.e. the target came
 *     through free-report's Places autocomplete): direct overlap between
 *     the target's own real Places `types[]` and the candidate's — the same
 *     taxonomy Google uses for both sides, so e.g. two businesses Google
 *     both typed "school" match even though "School" shares no word with a
 *     human-typed category like "IT Training Institute".
 *  2. Label-word fallback (target has no stored types — manual onboarding,
 *     or a pre-existing business from before this field existed): compares
 *     the candidate's derived category label against the search category
 *     string actually used, word-overlap based. Lenient by design — this
 *     only needs to catch genuinely unrelated results, not achieve precise
 *     category matching.
 * Either way, a candidate with no specific type at all (only generic bucket
 * types) is treated as unknown, not rejected — missing data shouldn't count
 * against it.
 */
function isRelevantCandidate(
  targetCategoryLabel: string,
  candidateTypes: string[],
  targetTypes: string[] | undefined,
): boolean {
  const specificCandidateTypes = candidateTypes.filter((t) => !GENERIC_PLACE_TYPES.has(t));
  if (specificCandidateTypes.length === 0) return true; // nothing specific to disagree with

  const specificTargetTypes = (targetTypes || []).filter((t) => !GENERIC_PLACE_TYPES.has(t));
  if (specificTargetTypes.length > 0) {
    const targetSet = new Set(specificTargetTypes);
    return specificCandidateTypes.some((t) => targetSet.has(t));
  }

  const targetTokens = tokenizeCategoryLabel(targetCategoryLabel);
  if (targetTokens.size === 0) return true; // target category itself carries no comparable signal

  return specificCandidateTypes.some((t) => {
    const label = deriveCategory([t]);
    if (!label) return false;
    const candidateTokens = tokenizeCategoryLabel(label);
    for (const tok of candidateTokens) {
      if (targetTokens.has(tok)) return true;
    }
    return false;
  });
}

export function calculateGapAnalysis(target: BusinessData, comp: Competitor) {
  const missingAdvantages = [];
  let gapScore = 100;

  if (comp.reviewCount > target.reviewCount) {
    const diff = comp.reviewCount - target.reviewCount;
    missingAdvantages.push(`+${diff} Reviews`);
    gapScore -= Math.min(30, diff * 0.5);
  }

  if (comp.website && !target.website) {
    missingAdvantages.push('Active Website Presence');
    gapScore -= 20;
  }

  if (comp.rating > 0) {
    gapScore -= 10;
  }

  return {
    missingAdvantages: missingAdvantages.slice(0, 3),
    gapScore: Math.max(0, gapScore),
  };
}

export async function findCompetitors(businessData: BusinessData): Promise<{
  accepted: any[];
  rejected: any[];
  targetTier: string;
  evidenceSource: string;
}> {
  const targetIsEnterprise = isEnterpriseBrand(businessData.businessName, businessData.reviewCount);
  const targetTier = classifyBusinessTier(businessData.reviewCount, !!businessData.website, targetIsEnterprise);

  if (!GOOGLE_MAPS_KEY) {
    console.warn('[findCompetitors] GOOGLE_MAPS_API_KEY not set — skipping competitor discovery');
    return { accepted: [], rejected: [], targetTier, evidenceSource: 'No GOOGLE_MAPS_API_KEY configured' };
  }

  const location = (businessData.city || businessData.state || businessData.country || '').trim();
  if (!location) {
    console.warn('[findCompetitors] No location data — cannot build search queries');
    return { accepted: [], rejected: [], targetTier, evidenceSource: 'No location data available' };
  }

  // A stored category this generic ("Services", "Local Business", etc. —
  // see resolveSearchCategory) searches on essentially every business in
  // the city with equal weight — falls back to a name-derived keyword
  // instead. See seoAnalyzer.ts for the full reasoning; same fix applied
  // here since this query is independent of the DataForSEO one.
  const effectiveCategory = resolveSearchCategory(
    businessData.category,
    businessData.businessName,
    [businessData.city, businessData.area, businessData.state],
  );

  // Build 2-3 queries from specific → broad
  const queries: string[] = [];
  if (businessData.area && businessData.city) {
    queries.push(`${effectiveCategory} in ${businessData.area}, ${businessData.city}`);
  }
  queries.push(`${effectiveCategory} in ${location}`);
  queries.push(`best ${effectiveCategory} ${location}`);

  // The 2-3 queries are independent — fire them concurrently instead of
  // sequentially (each has its own 15s timeout, so waiting on them one at a
  // time could add up to several seconds of pure network latency for no
  // reason). Results are still processed in the original specific→broad
  // order below, so priority/dedup behavior is unchanged.
  const queryResults: any[][] = await Promise.all(
    queries.map(async (query) => {
      try {
        const response = await axios.get(PLACES_BASE, {
          params: {
            query,
            key: GOOGLE_MAPS_KEY,
            type: 'establishment',
          },
          timeout: 15000,
        });

        const results: any[] = response.data.results || [];
        console.log(`[findCompetitors] Google Places query "${query}" → ${results.length} results`);

        if (response.data.status && response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
          console.error(`[findCompetitors] Google Places API error: ${response.data.status} — ${response.data.error_message || ''}`);
        }
        return results;
      } catch (error: any) {
        console.error(`[findCompetitors] Error for query "${query}":`, error.message);
        return [];
      }
    }),
  );

  // Collect every deduped candidate first (no early cap here) so relevance
  // filtering below has the full pool to choose from — capping at 10 before
  // filtering would risk keeping irrelevant results just because they
  // happened to rank first in the raw Places response.
  const candidates: Array<{ competitor: Competitor; tier: string; relevant: boolean }> = [];
  const seenNames = new Set<string>();

  for (const results of queryResults) {
    for (const place of results) {
      if (!place.name) continue;

      const nameKey = place.name.toLowerCase().trim();
      if (nameKey === businessData.businessName.toLowerCase().trim()) continue;
      if (seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);

      const compReviewCount = place.user_ratings_total || 0;
      const compIsEnterprise = isEnterpriseBrand(place.name, compReviewCount);
      const compTier = classifyBusinessTier(compReviewCount, false, compIsEnterprise);
      const placeTypes: string[] = place.types || [];

      const competitor: Competitor = {
        name: place.name,
        rating: place.rating || 0,
        reviewCount: compReviewCount,
        // Real category derived from THIS candidate's own Places types —
        // previously just copied the target's own category onto every row,
        // which made the field identical (and meaningless) for every
        // competitor by construction.
        category: deriveCategory(placeTypes) || businessData.category,
        address: place.formatted_address,
        similarityScore: 80,
        strengthScore: Math.round((place.rating || 0) * 20),
      };

      competitor.gapAnalysis = calculateGapAnalysis(businessData, competitor);
      candidates.push({
        competitor,
        tier: compTier,
        relevant: isRelevantCandidate(effectiveCategory, placeTypes, businessData.googleTypes),
      });
    }
  }

  const relevant = candidates.filter((c) => c.relevant);
  // Never drop to zero because of the filter — a report with some loosely-
  // related competitors is more useful than one with none. Only falls back
  // to the unfiltered pool when EVERY candidate failed the relevance check
  // (the exact "Services" → ambulance/cleaning/catering scenario this was
  // built for would instead usually just shrink the list, not empty it).
  const chosen = relevant.length > 0 ? relevant : candidates;
  if (relevant.length < candidates.length) {
    console.log(
      `[findCompetitors] Relevance filter dropped ${candidates.length - relevant.length}/${candidates.length} candidates for "${businessData.businessName}"` +
      (relevant.length === 0 ? ' — all candidates failed, falling back to the unfiltered pool.' : '.')
    );
  }

  const accepted = chosen.slice(0, 10).map(({ competitor, tier }) => ({ ...competitor, tier }));

  console.log(`[findCompetitors] Total accepted: ${accepted.length} for "${businessData.businessName}"`);

  return {
    accepted,
    rejected: [],
    targetTier,
    evidenceSource: `Google Places API: ${queries.slice(0, 2).join(' | ')}`,
  };
}
