import axios from 'axios';

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

  // Build 2-3 queries from specific → broad
  const queries: string[] = [];
  if (businessData.area && businessData.city) {
    queries.push(`${businessData.category} in ${businessData.area}, ${businessData.city}`);
  }
  queries.push(`${businessData.category} in ${location}`);
  queries.push(`best ${businessData.category} ${location}`);

  const accepted: any[] = [];
  const seenNames = new Set<string>();

  for (const query of queries) {
    if (accepted.length >= 10) break;

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

      for (const place of results) {
        if (accepted.length >= 10) break;
        if (!place.name) continue;

        const nameKey = place.name.toLowerCase().trim();
        if (nameKey === businessData.businessName.toLowerCase().trim()) continue;
        if (seenNames.has(nameKey)) continue;
        seenNames.add(nameKey);

        const compReviewCount = place.user_ratings_total || 0;
        const compIsEnterprise = isEnterpriseBrand(place.name, compReviewCount);
        const compTier = classifyBusinessTier(compReviewCount, false, compIsEnterprise);

        const competitor: Competitor = {
          name: place.name,
          rating: place.rating || 0,
          reviewCount: compReviewCount,
          category: businessData.category,
          address: place.formatted_address,
          similarityScore: 80,
          strengthScore: Math.round((place.rating || 0) * 20),
        };

        competitor.gapAnalysis = calculateGapAnalysis(businessData, competitor);
        accepted.push({ ...competitor, tier: compTier });
      }
    } catch (error: any) {
      console.error(`[findCompetitors] Error for query "${query}":`, error.message);
    }
  }

  console.log(`[findCompetitors] Total accepted: ${accepted.length} for "${businessData.businessName}"`);

  return {
    accepted: accepted.slice(0, 10),
    rejected: [],
    targetTier,
    evidenceSource: `Google Places API: ${queries.slice(0, 2).join(' | ')}`,
  };
}
