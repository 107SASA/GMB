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
  volumeBand: VolumeBand;
  estimated: boolean;
  /** Maps rank (1..20), or NOT_FOUND_RANK (21) → rendered "20+". */
  mapsRank: number;
}

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
      return {
        keyword,
        searchVolume: typeof live === 'number' ? live : null,
        volumeBand: liveBand,
        estimated: false,
        mapsRank: rank ?? NOT_FOUND_RANK,
      };
    }
    return {
      keyword,
      searchVolume: null,
      volumeBand: estimateKeywordVolume(keyword, { cityTier, city: opts.city, area: opts.area }),
      estimated: true,
      mapsRank: rank ?? NOT_FOUND_RANK,
    };
  });
}
