import { fetchSearchVolumes } from './keywordVolumeClient';
import {
  bandFromVolume,
  estimateKeywordVolume,
  cityTierFor,
  type VolumeBand,
} from '@/lib/cityTierVolume';
import { NOT_FOUND_RANK } from './seoAnalyzer';

/**
 * One row of the "Keyword Search Volume Analysis — Google Maps" table.
 * `estimated` drives the `*` in the UI — never show an unlabeled band that
 * didn't come from live Google Ads data.
 */
export interface KeywordTableRow {
  keyword: string;
  /** Live monthly volume from Google Ads, or null when estimated. */
  searchVolume: number | null;
  /** ≈ searchVolume × 0.62 when the search volume is real; null otherwise. */
  mapsVolume: number | null;
  volumeBand: VolumeBand;
  estimated: boolean;
  /** Maps rank (1..20), or NOT_FOUND_RANK (21) → rendered "20+". */
  mapsRank: number;
}

/** Local patient/customer searches on Google Maps run lower than the same
 *  phrase on Google Search — a stable ~0.62 ratio in local-services verticals.
 *  Only derived from a REAL search volume, never from an estimate. */
const MAPS_VOLUME_RATIO = 0.62;

export interface BuildKeywordTableOpts {
  city?: string;
  area?: string;
  country?: string;
}

/**
 * Given the keywords already ranked in the audit (keyword → Maps rank),
 * attach a demand band to each: live band from Google Ads volume when we can
 * get it, a labeled city-tier estimate otherwise.
 */
export async function buildKeywordTable(
  rankedKeywords: Array<{ keyword: string; rank: number }>,
  opts: BuildKeywordTableOpts = {},
): Promise<KeywordTableRow[]> {
  const keywords = rankedKeywords.map((k) => k.keyword).filter(Boolean);
  if (keywords.length === 0) return [];

  const cityTier = cityTierFor(opts.city);
  let liveVolumes = new Map<string, number | null>();
  try {
    liveVolumes = await fetchSearchVolumes(keywords, { countryHint: opts.country });
  } catch {
    liveVolumes = new Map();
  }

  return rankedKeywords.map(({ keyword, rank }) => {
    const live = liveVolumes.get(keyword.trim().toLowerCase());
    const liveBand = bandFromVolume(live);
    if (liveBand) {
      const sv = typeof live === 'number' ? live : null;
      return {
        keyword,
        searchVolume: sv,
        mapsVolume: sv != null && sv > 0 ? Math.round(sv * MAPS_VOLUME_RATIO) : null,
        volumeBand: liveBand,
        estimated: false,
        mapsRank: rank ?? NOT_FOUND_RANK,
      };
    }
    return {
      keyword,
      searchVolume: null,
      mapsVolume: null,
      volumeBand: estimateKeywordVolume(keyword, { cityTier, city: opts.city, area: opts.area }),
      estimated: true,
      mapsRank: rank ?? NOT_FOUND_RANK,
    };
  });
}
