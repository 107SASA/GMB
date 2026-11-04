/**
 * Raw Google Maps searches → one measurement row per (keyword, location),
 * keyed by stable ids so monthly audits compare like-for-like. Pure.
 *
 * A row is comparable with last month's only when the same keyword was
 * searched at the same location with the same number of points and both
 * measurements succeeded — anything else is "not comparable", never a change.
 * A failed search is UNAVAILABLE, never "not found"; a keyword with no search
 * is simply absent (NOT_MEASURED), never zero.
 */
import { ADDRESS_AREA_ID, keywordId } from './ids.ts';
import type { SearchObservation } from '../audit/facts.ts';

export type MeasurementScope = 'address_grid' | 'address_tracked' | 'service_area';

export interface KeywordMeasurement {
  id: string;
  keyword: string;
  serviceId: string | null;
  service: string | null;
  areaId: string;
  area: string;
  scope: MeasurementScope;
  /** Searches run for this keyword at this location. */
  points: number;
  /** Searches that returned results. */
  okCount: number;
  /** Searches where the business was in the top 20. */
  foundCount: number;
  bestRank: number | null;
  /** Mean position over the searches where it was found. */
  avgRank: number | null;
  status: 'measured' | 'unavailable';
  /** Google Ads monthly searches (country level); null = not enough data. */
  searchVolume: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function measurementRows(
  obs: SearchObservation[],
  opts: {
    scope: MeasurementScope;
    areaOf: (o: SearchObservation) => { id: string; name: string };
    serviceOf: (keyword: string) => { id: string; name: string } | null;
    volumes?: Map<string, number | null>;
  },
): KeywordMeasurement[] {
  const groups = new Map<string, { o: SearchObservation[]; area: { id: string; name: string } }>();
  for (const o of obs) {
    const area = opts.areaOf(o);
    const k = `${keywordId(o.keyword)}@${area.id}`;
    const g = groups.get(k) || { o: [], area };
    g.o.push(o);
    groups.set(k, g);
  }
  return Array.from(groups.values()).map(({ o, area }) => {
    const ok = o.filter((x) => x.status === 'ok');
    const ranks = ok.filter((x) => x.found && x.rank != null).map((x) => x.rank as number);
    const svc = opts.serviceOf(o[0].keyword);
    return {
      id: keywordId(o[0].keyword),
      keyword: o[0].keyword,
      serviceId: svc?.id ?? null,
      service: svc?.name ?? null,
      areaId: area.id,
      area: area.name,
      scope: opts.scope,
      points: o.length,
      okCount: ok.length,
      foundCount: ranks.length,
      bestRank: ranks.length ? Math.min(...ranks) : null,
      avgRank: ranks.length ? round1(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null,
      status: ok.length ? 'measured' : 'unavailable',
      searchVolume: opts.volumes?.get(o[0].keyword.toLowerCase()) ?? null,
    };
  });
}

export const addressArea = (label: string) => ({ id: ADDRESS_AREA_ID, name: label });

export type ChangeKind = 'improved' | 'declined' | 'stable' | 'new' | 'not_comparable';

export interface MeasurementChange {
  id: string;
  keyword: string;
  serviceId: string | null;
  service: string | null;
  areaId: string;
  area: string;
  change: ChangeKind;
  before: string;
  after: string;
  note?: string;
}

/** "#4 (avg, 3 of 3 searches)" / "not in top 20 (3 searches)" / "unavailable". */
export function positionText(m: KeywordMeasurement | null | undefined): string {
  if (!m) return 'not measured';
  if (m.status !== 'measured') return 'unavailable';
  if (m.avgRank == null) return `not in top 20 (${m.okCount} search${m.okCount === 1 ? '' : 'es'})`;
  return m.okCount > 1 ? `#${m.avgRank} avg, top 20 in ${m.foundCount} of ${m.okCount}` : `#${m.avgRank}`;
}

const rowKey = (m: { id: string; areaId: string }) => `${m.id}@${m.areaId}`;

/**
 * Like-for-like change per (keyword, location). "Improved" = now in the top
 * 20 when it was not, or average position better by at least one place
 * (lower number); "declined" the reverse; otherwise "stable".
 */
export function compareMeasurements(prev: KeywordMeasurement[] | null | undefined, cur: KeywordMeasurement[]): MeasurementChange[] {
  const before = new Map((prev || []).map((m) => [rowKey(m), m]));
  return cur.map((c) => {
    const p = before.get(rowKey(c));
    const base = { id: c.id, keyword: c.keyword, serviceId: c.serviceId, service: c.service, areaId: c.areaId, area: c.area, before: positionText(p), after: positionText(c) };
    if (!p) return { ...base, change: 'new' as const, note: 'First measured this month' };
    if (p.status !== 'measured' || c.status !== 'measured') return { ...base, change: 'not_comparable' as const, note: 'One of the two measurements was unavailable' };
    if (p.points !== c.points || p.okCount !== c.okCount) return { ...base, change: 'not_comparable' as const, note: 'Measured at a different number of points' };
    const wasFound = p.avgRank != null;
    const isFound = c.avgRank != null;
    if (!wasFound && !isFound) return { ...base, change: 'stable' as const };
    if (!wasFound && isFound) return { ...base, change: 'improved' as const };
    if (wasFound && !isFound) return { ...base, change: 'declined' as const };
    const d = (p.avgRank as number) - (c.avgRank as number);
    return { ...base, change: d >= 1 ? 'improved' as const : d <= -1 ? 'declined' as const : 'stable' as const };
  });
}
