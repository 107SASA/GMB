/**
 * Raw provider results → the keyword system's measured fields
 * (docs/KEYWORD_SYSTEM_PLAN.md S2/S4/S5). Pure.
 *
 *   rankFromObservations   Google Maps searches for one keyword → KeywordRank
 *   competitorsAboveFrom   the businesses Google showed above us → top 3
 *   volumeOf               Google Ads numbers for one keyword → KeywordVolume
 *
 * A failed search is 'unavailable', never "not found"; no search at all is
 * 'not_measured'. Volumes are Google Ads numbers only.
 */
import type { AreaDemand } from '../audit/areaDemand.ts';
import type { SearchObservation } from '../audit/facts.ts';
import type { CompetitorAbove, KeywordRank, KeywordVolume } from './keywordTypes.ts';

const round1 = (n: number) => Math.round(n * 10) / 10;
export const obsKey = (keyword: string) => String(keyword || '').trim().toLowerCase();

export function rankFromObservations(obs: SearchObservation[]): KeywordRank {
  if (!obs.length) return { avg: null, best: null, foundPct: 0, points: 0, status: 'not_measured' };
  const ok = obs.filter((o) => o.status === 'ok');
  if (!ok.length) return { avg: null, best: null, foundPct: 0, points: obs.length, status: 'unavailable' };
  const ranks = ok.filter((o) => o.found && typeof o.rank === 'number').map((o) => o.rank as number);
  return {
    avg: ranks.length ? round1(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null,
    best: ranks.length ? Math.min(...ranks) : null,
    foundPct: round1(ranks.length / ok.length),
    points: ok.length,
    status: 'measured',
  };
}

/**
 * The businesses most often above us for this keyword: by average position
 * over the searches they appeared above us in, top 3. When we are not in the
 * top 20 every listed business counts as above.
 */
export function competitorsAboveFrom(obs: SearchObservation[], max = 3): CompetitorAbove[] {
  const by = new Map<string, { name: string; positions: number[]; reviews: number | null; rating: number | null }>();
  for (const o of obs) {
    if (o.status !== 'ok') continue;
    for (const item of o.ahead || []) {
      const key = item.placeId || item.cid || item.name.trim().toLowerCase();
      if (!key) continue;
      const row = by.get(key) ?? { name: item.name, positions: [], reviews: null, rating: null };
      row.positions.push(item.position);
      if (typeof item.reviewCount === 'number') row.reviews = Math.max(row.reviews ?? 0, item.reviewCount);
      if (typeof item.rating === 'number' && item.rating > 0) row.rating = item.rating;
      by.set(key, row);
    }
  }
  return Array.from(by.values())
    .map((r) => ({ ...r, avg: r.positions.reduce((a, b) => a + b, 0) / r.positions.length }))
    .sort((a, b) => b.positions.length - a.positions.length || a.avg - b.avg)
    .slice(0, max)
    .map((r) => ({ name: r.name, rank: Math.round(r.avg), reviews: r.reviews, rating: r.rating }))
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Volume fields for one keyword from the lookups that ran: `country` / `city`
 * maps hold Google Ads answers keyed by the lowercased keyword (absent = not
 * asked; null = Google answered with too few searches).
 */
export function volumeOf(
  keyword: string,
  maps: { country: Map<string, number | null>; city?: Map<string, number | null>; area?: Map<string, AreaDemand>; ideaVolume?: number | null },
  measuredAt: string,
): KeywordVolume {
  const k = obsKey(keyword);
  const askedCountry = maps.country.has(k);
  const askedCity = !!maps.city?.has(k);
  const country = askedCountry ? maps.country.get(k) ?? null : null;
  const city = askedCity ? maps.city!.get(k) ?? null : null;
  const area = maps.area?.get(k) ?? null;
  const ideas = typeof maps.ideaVolume === 'number' && maps.ideaVolume > 0 ? maps.ideaVolume : null;
  const anyNumber = [country, city, area?.searchVolume, ideas].some((v) => typeof v === 'number' && v > 0);
  const asked = askedCountry || askedCity || !!area || maps.ideaVolume !== undefined;
  return {
    country: country ?? ideas,
    city,
    area,
    status: anyNumber ? 'measured' : asked ? 'too_few_searches' : 'not_measured',
    measuredAt: asked ? measuredAt : null,
  };
}

/** Observations grouped by lowercased keyword. */
export function groupByKeyword(obs: SearchObservation[]): Map<string, SearchObservation[]> {
  const out = new Map<string, SearchObservation[]>();
  for (const o of obs) {
    const k = obsKey(o.keyword);
    const list = out.get(k) ?? [];
    list.push(o);
    out.set(k, list);
  }
  return out;
}
