/**
 * Search-volume demand bands.
 *
 * Live monthly volume comes from DataForSEO's Google Ads endpoint
 * (src/services/audit/keywordVolumeClient.ts). When Google Ads returns a
 * real number — including 0 — we band it directly with `bandFromVolume`.
 *
 * When it returns nothing (Keyword Planner has no data for the phrase, the
 * account isn't provisioned for Ads data, credentials are missing), we fall
 * back to a coarse estimate by city tier + phrase shape. Every estimated row
 * MUST be flagged (`estimated: true`) and rendered with a `*` — we never show
 * an unlabeled invented number.
 */

export type VolumeBand = 'HIGH' | 'MED' | 'LOW' | 'NICHE';

/**
 * Band a real monthly search volume. Returns undefined only when there is no
 * number at all (so callers can decide to estimate). A live 0 is real data —
 * it means "people effectively don't search this" — and bands to NICHE.
 */
export function bandFromVolume(n?: number | null): VolumeBand | undefined {
  if (n == null || Number.isNaN(n)) return undefined;
  if (n <= 0) return 'NICHE';
  if (n >= 1000) return 'HIGH';
  if (n >= 200) return 'MED';
  if (n >= 30) return 'LOW';
  return 'NICHE';
}

/** Rough population/search-market tier for an Indian city. Tier 1 = metro. */
export type CityTier = 1 | 2 | 3;

const TIER1_CITIES = new Set([
  'mumbai', 'delhi', 'new delhi', 'bengaluru', 'bangalore', 'hyderabad',
  'chennai', 'kolkata', 'pune', 'ahmedabad', 'surat',
]);
const TIER2_CITIES = new Set([
  'jaipur', 'lucknow', 'kanpur', 'nagpur', 'indore', 'thane', 'bhopal',
  'visakhapatnam', 'patna', 'vadodara', 'ghaziabad', 'ludhiana', 'agra',
  'nashik', 'faridabad', 'meerut', 'rajkot', 'varanasi', 'srinagar',
  'aurangabad', 'dhanbad', 'amritsar', 'navi mumbai', 'allahabad',
  'prayagraj', 'ranchi', 'howrah', 'coimbatore', 'jabalpur', 'gwalior',
  'vijayawada', 'jodhpur', 'madurai', 'raipur', 'kota', 'chandigarh',
  'guwahati', 'noida', 'gurgaon', 'gurugram',
]);

export function cityTierFor(city?: string): CityTier {
  const c = (city || '').trim().toLowerCase();
  if (!c) return 3;
  if (TIER1_CITIES.has(c)) return 1;
  if (TIER2_CITIES.has(c)) return 2;
  return 3;
}

/**
 * Estimated demand band when Google Ads returned no live number.
 * Deliberately conservative — a city-wide category phrase in a metro is at
 * most MED here, a hyper-local "<service> <neighbourhood>" phrase is LOW or
 * NICHE. The band is always labeled estimated by the caller.
 */
export function estimateKeywordVolume(
  keyword: string,
  opts: { cityTier?: CityTier; city?: string; area?: string } = {},
): VolumeBand {
  const kw = (keyword || '').trim().toLowerCase();
  const tier = opts.cityTier ?? cityTierFor(opts.city);
  const city = (opts.city || '').trim().toLowerCase();
  const area = (opts.area || '').trim().toLowerCase();

  const words = kw.split(/\s+/).filter(Boolean);
  const mentionsCity = !!city && kw.includes(city);
  const mentionsArea = !!area && kw.includes(area);
  // A neighbourhood/locality phrase: has a place token that isn't the city.
  const hyperLocal = mentionsArea || (words.length >= 3 && !mentionsCity && /\b(near|in|at)\b/.test(kw));
  const brandish = words.length <= 2 && !mentionsCity; // likely the business's own name

  if (brandish) return tier === 1 ? 'MED' : 'LOW';
  if (hyperLocal) return tier === 1 ? 'LOW' : 'NICHE';
  if (mentionsCity) {
    // "<category> <city>" / "best <category> <city>" — the workhorse phrases.
    if (tier === 1) return 'MED';
    if (tier === 2) return 'LOW';
    return 'NICHE';
  }
  // Bare category with no place — broad, but intent is diffuse.
  return tier === 1 ? 'MED' : 'LOW';
}

const BAND_ORDER: Record<VolumeBand, number> = { HIGH: 3, MED: 2, LOW: 1, NICHE: 0 };
export function compareBands(a: VolumeBand, b: VolumeBand): number {
  return BAND_ORDER[b] - BAND_ORDER[a];
}
