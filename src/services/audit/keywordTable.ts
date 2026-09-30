import { fetchSearchVolumes } from './keywordVolumeClient';
import { bandFromVolume, type VolumeBand } from '@/lib/cityTierVolume';

/**
 * One row of the "Keyword Search Volume Analysis — Google Maps" table.
 *
 * Sep 2026: demand is shown ONLY when Google Ads (via DataForSEO) returned a
 * real monthly volume. Previously a missing volume became a city-tier guess
 * (HIGH/MED/LOW/NICHE with a `*`), and a "Maps volume" was derived from it
 * with an unsourced ×0.62 ratio. Both were invented demand; now such rows
 * are `demandStatus: 'unavailable'` and the UI says so.
 */
export interface KeywordTableRow {
  keyword: string;
  /** Live monthly volume from Google Ads, or null when unavailable. */
  searchVolume: number | null;
  /** Not derived any more (no sourced search→Maps ratio exists). Always null. */
  mapsVolume: null;
  /** Band of the MEASURED volume; null when demand is unavailable. */
  volumeBand: VolumeBand | null;
  demandStatus: 'measured' | 'unavailable';
  /** Kept for older readers: true exactly when demand is unavailable. */
  estimated: boolean;
  /** Observed position when found in the top 20; null otherwise. */
  mapsRank: number | null;
  rank: number | null;
  found: boolean;
  /** 'unavailable' = the ranking provider failed for this phrase. */
  rankStatus: 'ok' | 'unavailable';
}

export interface BuildKeywordTableOpts {
  city?: string;
  area?: string;
  country?: string;
}

/**
 * Given the keywords already ranked in the audit, attach measured demand
 * when Google Ads has it.
 */
export async function buildKeywordTable(
  rankedKeywords: Array<{ keyword: string; rank: number | null; found?: boolean; status?: 'ok' | 'unavailable' }>,
  opts: BuildKeywordTableOpts = {},
): Promise<KeywordTableRow[]> {
  const keywords = rankedKeywords.map((k) => k.keyword).filter(Boolean);
  if (keywords.length === 0) return [];

  let liveVolumes = new Map<string, number | null>();
  try {
    liveVolumes = await fetchSearchVolumes(keywords, { countryHint: opts.country });
  } catch {
    liveVolumes = new Map();
  }

  return rankedKeywords.map(({ keyword, rank, found, status }) => {
    const rankStatus = status ?? 'ok';
    const isFound = rankStatus === 'ok' && (found ?? rank != null) && rank != null;
    const live = liveVolumes.get(keyword.trim().toLowerCase());
    const band = bandFromVolume(live) ?? null;
    return {
      keyword,
      searchVolume: typeof live === 'number' ? live : null,
      mapsVolume: null,
      volumeBand: band,
      demandStatus: band ? 'measured' : 'unavailable',
      estimated: !band,
      mapsRank: isFound ? rank : null,
      rank: isFound ? rank : null,
      found: isFound,
      rankStatus,
    };
  });
}
